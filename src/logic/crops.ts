import { FIELD, getCrop, type CropDef } from '../data/crops';
import { startTimer, timerDone, timerProgress, timerRemaining, type Timer } from './clock';
import { START_LAND } from './constants';
import type { Game } from './game';
import { addStartingObject, onNewGame } from './state';
import type { ClockState, PlacedObject } from './types';

/** Per-field state, saved with the object. */
export type FieldState = {
  /** Crop id, or null when the field is empty. */
  crop: string | null;
  /** Growth timer on the game clock; set while a crop is planted. */
  timer: Timer | null;
};

export type CropStage = 'empty' | 'seeded' | 'sprout' | 'growing' | 'ripe';

/** Growth progress at which each stage begins. Ripe is progress 1. */
export const STAGE_STARTS = { seeded: 0, sprout: 0.25, growing: 0.6 } as const;

/** Where the starting fields go: two 2×2 fields in the top-left of the starting land. */
export const STARTING_FIELDS = [
  { x: START_LAND.x + 1, y: START_LAND.y + 1 },
  { x: START_LAND.x + 4, y: START_LAND.y + 1 },
] as const;

onNewGame((state) => {
  for (const { x, y } of STARTING_FIELDS) addStartingObject(state, FIELD, x, y);
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

export type PlantResult = { ok: true } | { ok: false; reason: 'unknown-crop' | 'level' | 'occupied' | 'money' };

/** Charges the crop's cost and plants it. Nothing changes when it fails. */
export function plant(game: Game, obj: PlacedObject<FieldState>, cropId: string): PlantResult {
  const crop = getCrop(cropId);
  if (!crop) return { ok: false, reason: 'unknown-crop' };
  if (!game.isUnlocked(crop.unlockLevel)) return { ok: false, reason: 'level' };
  if (cropStage(game.state.clock, obj.state) !== 'empty') return { ok: false, reason: 'occupied' };
  if (!game.spend(crop.plantCost)) return { ok: false, reason: 'money' };
  obj.state.crop = crop.id;
  obj.state.timer = startTimer(game.state.clock, crop.growMs);
  game.touch(obj);
  game.activity.emit('planted', { crop: crop.id });
  return { ok: true };
}

/** Moves a ripe crop to the inventory and empties the field. Returns what was harvested, or null if not ripe. */
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
