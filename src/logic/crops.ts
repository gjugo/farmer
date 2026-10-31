import { FIELD, getCrop, type CropDef } from '../data/crops';
import { PLOUGH_COST, PLOUGH_SEASONS } from '../data/seasons';
import { startTimer, timerDone, timerProgress, timerRemaining, type Timer } from './clock';
import { START_LAYOUT } from './constants';
import type { Game } from './game';
import { nextSeasonIn, seasonRunEnd } from './seasons';
import { addStartingObject, onNewGame } from './state';
import type { ClockState, PlacedObject } from './types';

/** Per-field state, saved with the object. */
export type FieldState = {
  /** Crop id, or null when the field is empty. */
  crop: string | null;
  /** Growth timer on the game clock; set while a crop is planted. */
  timer: Timer | null;
  /** Game time the soil was last ploughed; null when never. Ploughing wears off with the winter frost (see `isPloughed`). */
  ploughedAt: number | null;
};

export type CropStage = 'empty' | 'seeded' | 'sprout' | 'growing' | 'ripe';

/** Growth progress at which each stage begins. Ripe is progress 1. */
export const STAGE_STARTS = { seeded: 0, sprout: 0.25, growing: 0.6 } as const;

/** Where the starting fields go: two 2×2 fields at the start of the new farm's layout. */
export const STARTING_FIELDS = [
  { x: START_LAYOUT.x, y: START_LAYOUT.y },
  { x: START_LAYOUT.x + 3, y: START_LAYOUT.y },
] as const;

onNewGame((state) => {
  for (const { x, y } of STARTING_FIELDS) {
    // Starting fields come ploughed, so the first crop can go in straight away.
    const field = addStartingObject(state, FIELD, x, y);
    if (field) (field.state as FieldState).ploughedAt = state.clock.elapsed;
  }
});

/** The planted crop, if its id is still known. */
export function fieldCrop(field: FieldState): CropDef | undefined {
  return field.crop ? getCrop(field.crop) : undefined;
}

export function growthProgress(clock: ClockState, field: FieldState): number {
  if (!fieldCrop(field) || !field.timer) return 0;
  return timerProgress(clock, field.timer);
}

export function cropStage(clock: ClockState, field: FieldState): CropStage {
  if (!fieldCrop(field) || !field.timer) return 'empty';
  if (timerDone(clock, field.timer)) return 'ripe';
  const p = timerProgress(clock, field.timer);
  if (p >= STAGE_STARTS.growing) return 'growing';
  if (p >= STAGE_STARTS.sprout) return 'sprout';
  return 'seeded';
}

/** Game milliseconds until the crop is ripe (0 when ripe or empty). */
export function timeToRipe(clock: ClockState, field: FieldState): number {
  return fieldCrop(field) && field.timer ? timerRemaining(clock, field.timer) : 0;
}

/** Is the soil ploughed now? It stays ploughed (through harvests) until the first season it cannot be ploughed in. */
export function isPloughed(clock: ClockState, field: FieldState): boolean {
  const at = field.ploughedAt;
  if (typeof at !== 'number' || at > clock.elapsed) return false;
  return clock.elapsed < seasonRunEnd(at, PLOUGH_SEASONS);
}

/** Game time at which ploughed soil goes back to unploughed (the frost); null when it is not ploughed. */
export function ploughedUntil(clock: ClockState, field: FieldState): number | null {
  return isPloughed(clock, field) ? seasonRunEnd(field.ploughedAt!, PLOUGH_SEASONS) : null;
}

/** Can fields be ploughed in the current season? */
export function canPloughNow(clock: ClockState): boolean {
  return nextSeasonIn(clock.elapsed, PLOUGH_SEASONS) === clock.elapsed;
}

export type PloughResult = { ok: true } | { ok: false; reason: 'occupied' | 'ploughed' | 'season' | 'money' };

/** Charges `PLOUGH_COST` and ploughs an empty field. Nothing changes when it fails. */
export function plough(game: Game, obj: PlacedObject<FieldState>): PloughResult {
  const clock = game.state.clock;
  if (cropStage(clock, obj.state) !== 'empty') return { ok: false, reason: 'occupied' };
  if (isPloughed(clock, obj.state)) return { ok: false, reason: 'ploughed' };
  if (!canPloughNow(clock)) return { ok: false, reason: 'season' };
  if (!game.spend(PLOUGH_COST)) return { ok: false, reason: 'money' };
  obj.state.ploughedAt = clock.elapsed;
  game.touch(obj);
  game.activity.emit('ploughed', {});
  return { ok: true };
}

/**
 * Can `crop` be sown now as far as the season goes? It must be one of its seasons, and the crop must be
 * ripe before they are over: "late" when there is not enough of the season left.
 */
export function seasonCheck(clock: ClockState, crop: CropDef): 'ok' | 'out-of-season' | 'late' {
  const end = seasonRunEnd(clock.elapsed, crop.seasons);
  if (end === clock.elapsed) return 'out-of-season';
  return clock.elapsed + crop.growMs <= end ? 'ok' : 'late';
}

export type PlantResult =
  | { ok: true }
  | { ok: false; reason: 'unknown-crop' | 'level' | 'occupied' | 'unploughed' | 'out-of-season' | 'late' | 'money' };

/** Charges the crop's cost and plants it. Nothing changes when it fails. */
export function plant(game: Game, obj: PlacedObject<FieldState>, cropId: string): PlantResult {
  const crop = getCrop(cropId);
  const clock = game.state.clock;
  if (!crop) return { ok: false, reason: 'unknown-crop' };
  if (!game.isUnlocked(crop.unlockLevel)) return { ok: false, reason: 'level' };
  if (cropStage(clock, obj.state) !== 'empty') return { ok: false, reason: 'occupied' };
  if (!isPloughed(clock, obj.state)) return { ok: false, reason: 'unploughed' };
  const season = seasonCheck(clock, crop);
  if (season !== 'ok') return { ok: false, reason: season };
  if (!game.spend(crop.plantCost)) return { ok: false, reason: 'money' };
  obj.state.crop = crop.id;
  obj.state.timer = startTimer(game.state.clock, crop.growMs);
  game.touch(obj);
  game.activity.emit('planted', { crop: crop.id });
  return { ok: true };
}

/**
 * Moves a ripe crop to the inventory and empties the field (the soil stays ploughed until the frost).
 * Returns what was harvested, or null if not ripe. A ripe crop keeps in the field, even into winter.
 */
export function harvest(game: Game, obj: PlacedObject<FieldState>): { crop: CropDef; qty: number } | null {
  const crop = fieldCrop(obj.state);
  if (!crop || cropStage(game.state.clock, obj.state) !== 'ripe') return null;
  game.addItem(crop.harvestItem, crop.harvestQty);
  obj.state.crop = null;
  obj.state.timer = null;
  game.touch(obj);
  game.activity.emit('harvested', { item: crop.harvestItem, qty: crop.harvestQty });
  return { crop, qty: crop.harvestQty };
}

/** "1:05" / "0:30" for a game-time duration, rounded up to whole seconds. */
export function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
