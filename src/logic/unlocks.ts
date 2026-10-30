import { ANIMALS, isAnimalKind, PENS } from '../data/animals';
import { getBuildable, listBuildMenu } from '../data/buildables';
import { CROP_LIST, getCrop } from '../data/crops';
import { PROCESSORS } from '../data/processing';
import { LEVEL_XP, MAX_LEVEL } from '../data/progression';
import { isPlainObject } from './slices';

/** Level needed for something with this `unlockLevel` (missing means level 1). */
export function isUnlocked(level: number, unlockLevel: number | undefined): boolean {
  return level >= (unlockLevel ?? 1);
}

export function buildableUnlockLevel(type: string): number {
  return getBuildable(type)?.unlockLevel ?? 1;
}

/** The level a total XP amount gives. */
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= LEVEL_XP[level]) level++;
  return level;
}

/** Total XP where `level` starts. */
export function xpForLevel(level: number): number {
  return LEVEL_XP[Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1];
}

/**
 * The lowest level at which an item can be obtained: grown, produced by an animal,
 * made in a building or (feed only) bought in a pen. Infinity when there is no source.
 */
export function itemUnlockLevel(itemId: string): number {
  const sources: number[] = [];
  for (const crop of CROP_LIST) if (crop.harvestItem === itemId) sources.push(crop.unlockLevel);
  for (const animal of Object.values(ANIMALS)) {
    if (animal.product === itemId) sources.push(Math.max(animal.unlockLevel, PENS[animal.pen].unlockLevel));
  }
  for (const p of Object.values(PROCESSORS)) {
    if (p.recipes.some((r) => r.output.item === itemId)) sources.push(p.unlockLevel);
  }
  // Feed packs are sold in every pen's panel.
  if (itemId === 'feed') sources.push(Math.min(...Object.values(PENS).map((p) => p.unlockLevel)));
  return Math.min(Infinity, ...sources);
}

export interface Unlock {
  icon: string;
  name: string;
}

/** Everything that becomes available exactly at `level`. */
export function unlocksAt(level: number): Unlock[] {
  const out: Unlock[] = [];
  for (const crop of CROP_LIST) if (crop.unlockLevel === level) out.push({ icon: crop.icon, name: crop.name });
  for (const animal of Object.values(ANIMALS)) if (animal.unlockLevel === level) out.push({ icon: animal.icon, name: animal.name });
  for (const b of listBuildMenu()) if ((b.unlockLevel ?? 1) === level) out.push({ icon: b.icon ?? '🔨', name: b.name });
  return out;
}

/**
 * The lowest level that unlocks everything on a farm (buildings, their animals and
 * planted crops). Used to place saves from before levels existed. Takes raw save data.
 */
export function requiredLevel(objects: unknown): number {
  let level = 1;
  if (!Array.isArray(objects)) return level;
  const need = (n: number | undefined) => (level = Math.max(level, n ?? 1));
  for (const o of objects) {
    if (!isPlainObject(o) || typeof o.type !== 'string') continue;
    need(buildableUnlockLevel(o.type));
    const state = isPlainObject(o.state) ? o.state : {};
    if (Array.isArray(state.animals)) {
      for (const a of state.animals) if (isPlainObject(a) && isAnimalKind(a.kind)) need(ANIMALS[a.kind].unlockLevel);
    }
    if (typeof state.crop === 'string') need(getCrop(state.crop)?.unlockLevel);
  }
  return Math.min(level, MAX_LEVEL);
}
