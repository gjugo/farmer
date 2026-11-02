import { PENS } from './animals';
import { PROCESSORS } from './processing';
import { RESOURCES } from './resourceBuildings';

/**
 * Perks: at every level-up from 2 to 10 the farm picks one of three, for good. Each is a number read at one place
 * in the rules through `perkFactor` (`src/logic/perks.ts`): a multiplier, or for Good neighbours approval points.
 */
export type PerkId =
  | 'green-thumb'
  | 'good-boots'
  | 'haggler'
  | 'husbandry'
  | 'master-builder'
  | 'big-barns'
  | 'thrifty'
  | 'warm-hearths'
  | 'good-neighbours'
  | 'rich-soil'
  | 'prospector'
  | 'quick-hands';

export interface PerkDef {
  id: PerkId;
  name: string;
  icon: string;
  /** What it does, one line. */
  description: string;
  /** What `perkFactor` gives once taken. */
  value: number;
  /** What `perkFactor` gives without it: 1 for a multiplier, 0 for points. */
  neutral: number;
  /**
   * Buildable types it is about (pens, processing or resource buildings): it is only offered once the farm has one
   * of them (built or being built). Missing: always offered.
   */
  subjects?: readonly string[];
}

/** Perks offered at each level-up. */
export const PERK_OFFERS = 3;

/** Levels that come with a perk choice: every one after the first. */
export const FIRST_PERK_LEVEL = 2;

/** The pool, in a fixed order (offers are drawn from it with the farm's seed). */
export const PERKS: readonly PerkDef[] = [
  { id: 'green-thumb', name: 'Green thumb', icon: '🌱', description: 'Harvests yield 15% more.', value: 1.15, neutral: 1 },
  // Walking takes 1/1.25 of the time: 25% faster.
  { id: 'good-boots', name: 'Good boots', icon: '🥾', description: 'Farmers walk 25% faster.', value: 1 / 1.25, neutral: 1 },
  { id: 'haggler', name: 'Haggler', icon: '🤝', description: 'The Market pays 10% more for goods (not materials).', value: 1.1, neutral: 1 },
  {
    id: 'husbandry',
    name: 'Husbandry',
    icon: '🐄',
    description: 'Animals produce 20% faster.',
    value: 1 / 1.2,
    neutral: 1,
    subjects: Object.keys(PENS),
  },
  { id: 'master-builder', name: 'Master builder', icon: '🔨', description: 'Building work is 30% faster.', value: 1 / 1.3, neutral: 1 },
  { id: 'big-barns', name: 'Big barns', icon: '🏚️', description: 'Granaries and storehouses hold 20% more.', value: 1.2, neutral: 1 },
  { id: 'thrifty', name: 'Thrifty', icon: '🪵', description: 'Buildings need 20% fewer materials.', value: 0.8, neutral: 1 },
  { id: 'warm-hearths', name: 'Warm hearths', icon: '🔥', description: 'Homes burn half the firewood in winter.', value: 0.5, neutral: 1 },
  { id: 'good-neighbours', name: 'Good neighbours', icon: '👪', description: 'Families’ approval +10.', value: 10, neutral: 0 },
  { id: 'rich-soil', name: 'Rich soil', icon: '🟫', description: 'Harvests drain the soil 30% less.', value: 0.7, neutral: 1 },
  {
    id: 'prospector',
    name: 'Prospector',
    icon: '⛏️',
    description: 'Lodges, quarries and mines yield 25% more.',
    value: 1.25,
    neutral: 1,
    subjects: Object.keys(RESOURCES),
  },
  {
    id: 'quick-hands',
    name: 'Quick hands',
    icon: '⚙️',
    description: 'Processing batches are 20% faster.',
    value: 1 / 1.2,
    neutral: 1,
    subjects: Object.keys(PROCESSORS),
  },
];

export function getPerk(id: string): PerkDef | undefined {
  return PERKS.find((p) => p.id === id);
}
