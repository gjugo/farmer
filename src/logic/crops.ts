import { getBuildable } from '../data/buildables';
import { getCrop, type CropDef } from '../data/crops';
import { PLOUGH_SEASONS, type Season } from '../data/seasons';
import { MANURE_GAIN, MANURE_PER_SPREAD, MAX_FERTILITY } from '../data/soil';
import { startTimer, timerDone, timerProgress, timerRemaining, type Timer } from './clock';
import { START_LAYOUT } from './constants';
import type { Game } from './game';
import { perkFactor } from './perks';
import { nextSeasonIn, seasonRunEnd } from './seasons';
import { droughtGrowMs, harvestShare } from './hazards';
import { afterHarvest, areaSoil, drainOf, restedFertility, yieldAt } from './soil';
import type { ClockState, GameState, PlacedObject } from './types';

/** Per-field state, saved with the object. */
export type FieldState = {
  /** Crop id, or null when the field is empty. */
  crop: string | null;
  /** Growth timer on the game clock; set while a crop is planted. */
  timer: Timer | null;
  /** Game time the soil was last ploughed; null when never. Ploughing wears off with the winter frost (see `isPloughed`). */
  ploughedAt: number | null;
  /**
   * Fertility in percentage points (0–100) when the field began resting, or while a crop grows. Read the current
   * value with `fertilityOf`: an empty field recovers toward its soil quality from `restingSince`. Missing in fields
   * placed before soil (`fertilityOf` then uses the soil quality).
   */
  fertility?: number | null;
  /** Game time since which the field has lain empty and recovers; null while a crop grows. */
  restingSince?: number | null;
  /** Crop id of the field's last harvest, or null: the same crop again drains twice as fast. */
  lastCrop?: string | null;
  /** A drought slowed the crop (no well nearby): its harvest is smaller (see `src/logic/hazards.ts`). Cleared at harvest. */
  parched?: boolean;
  /** Crows ate at the crop (no scarecrow nearby): its harvest is smaller. Cleared at harvest. */
  pecked?: boolean;
};

export type CropStage = 'empty' | 'seeded' | 'sprout' | 'growing' | 'ripe';

/** Growth progress at which each stage begins. Ripe is progress 1. */
export const STAGE_STARTS = { seeded: 0, sprout: 0.25, growing: 0.6 } as const;

/**
 * Where farms from before the camp start had their two ploughed starting fields (a new farm has none; tests lay them
 * out with `classicFarm`, `src/logic/test-utils.ts`).
 */
export const STARTING_FIELDS = [
  { x: START_LAYOUT.x, y: START_LAYOUT.y },
  { x: START_LAYOUT.x + 3, y: START_LAYOUT.y },
] as const;

/** The planted crop, if its id is still known. */
export function fieldCrop(field: FieldState): CropDef | undefined {
  return field.crop ? getCrop(field.crop) : undefined;
}

/** The field's soil quality: the average over its tiles. Resting brings fertility back to it. */
export function fieldSoil(obj: PlacedObject<FieldState>): number {
  return areaSoil({ x: obj.x, y: obj.y, ...(getBuildable(obj.type)?.footprint ?? { w: 2, h: 2 }) });
}

/** The field's fertility now (percentage points), with the rest it has had since it was last harvested. */
export function fertilityOf(clock: ClockState, obj: PlacedObject<FieldState>): number {
  const soil = fieldSoil(obj);
  const { fertility, restingSince } = obj.state;
  if (typeof fertility !== 'number' || !Number.isFinite(fertility)) return soil;
  // A field still growing a crop does not rest, whatever an edited save says.
  const since = obj.state.crop || typeof restingSince !== 'number' ? null : restingSince;
  return restedFertility(fertility, since, soil, clock.elapsed);
}

/** Writes down the fertility reached now, resting on from now (`rest`) or not while a crop grows. */
function settleFertility(clock: ClockState, obj: PlacedObject<FieldState>, fertility: number, rest: boolean): void {
  obj.state.fertility = fertility;
  obj.state.restingSince = rest ? clock.elapsed : null;
}

/**
 * What harvesting the field's crop would bring now: its quantity scaled by the field's fertility (and perks), less what
 * a drought or crows took (`harvestShare`). 0 when empty.
 */
export function harvestYield(state: GameState, obj: PlacedObject<FieldState>): number {
  const crop = fieldCrop(obj.state);
  return crop ? Math.round(yieldAt(crop.harvestQty, fertilityOf(state.clock, obj), perkFactor(state, 'green-thumb')) * harvestShare(obj.state)) : 0;
}

/** The field's last harvested crop, if its id is still known. */
export function lastCropOf(field: FieldState): CropDef | undefined {
  return typeof field.lastCrop === 'string' ? getCrop(field.lastCrop) : undefined;
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

export type PloughResult = { ok: true } | { ok: false; reason: 'occupied' | 'ploughed' | 'season' };

/** Ploughs an empty field (free: the cost is the farmer's time). Nothing changes when it fails. */
export function plough(game: Game, obj: PlacedObject<FieldState>): PloughResult {
  const clock = game.state.clock;
  if (cropStage(clock, obj.state) !== 'empty') return { ok: false, reason: 'occupied' };
  if (isPloughed(clock, obj.state)) return { ok: false, reason: 'ploughed' };
  if (!canPloughNow(clock)) return { ok: false, reason: 'season' };
  obj.state.ploughedAt = clock.elapsed;
  game.touch(obj);
  game.activity.emit('ploughed', {});
  return { ok: true };
}

/**
 * Can `crop` be sown now as far as the season goes? It must be one of its seasons, and the crop must be
 * ripe before they are over: "late" when there is not enough of the season left. Nothing is sown in frozen ground,
 * even a crop that grows into winter (cabbage is sown in autumn and ripens in winter).
 */
export function seasonCheck(clock: ClockState, crop: CropDef): 'ok' | 'out-of-season' | 'late' {
  const end = seasonRunEnd(clock.elapsed, crop.seasons);
  if (end === clock.elapsed || !canPloughNow(clock)) return 'out-of-season';
  return clock.elapsed + crop.growMs <= end ? 'ok' : 'late';
}

/** The seasons a crop can be sown in: its seasons with ploughable ground (cabbage grows into winter but is sown in autumn). */
export function sowSeasons(crop: CropDef): Season[] {
  return crop.seasons.filter((s) => PLOUGH_SEASONS.includes(s));
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
  settleFertility(clock, obj, fertilityOf(clock, obj), false);
  obj.state.crop = crop.id;
  delete obj.state.parched;
  delete obj.state.pecked;
  // In a drought, a field no well reaches grows slower.
  obj.state.timer = startTimer(game.state.clock, droughtGrowMs(game.state, obj, clock.elapsed, crop.growMs));
  game.touch(obj);
  game.activity.emit('planted', { crop: crop.id });
  return { ok: true };
}

export type HarvestResult = { ok: true; crop: CropDef; qty: number } | { ok: false; reason: 'not-ripe' | 'full' };

/**
 * Moves a ripe crop to the inventory and empties the field (the soil stays ploughed until the frost).
 * The yield follows the field's fertility (`harvestYield`), and the harvest drains it by the crop's
 * `soilDrain`, twice that when the field's last harvest was the same crop; then the field rests.
 * A ripe crop keeps in the field, even into winter. Refused (nothing changes) when it isn't ripe, or when
 * the granaries have no room for the whole harvest: then the crop stays ripe in the field.
 */
export function harvest(game: Game, obj: PlacedObject<FieldState>): HarvestResult {
  const clock = game.state.clock;
  const crop = fieldCrop(obj.state);
  if (!crop || cropStage(clock, obj.state) !== 'ripe') return { ok: false, reason: 'not-ripe' };
  const fertility = fertilityOf(clock, obj);
  const qty = harvestYield(game.state, obj);
  if (game.spaceFor(crop.harvestItem) < qty) return { ok: false, reason: 'full' };
  game.addItem(crop.harvestItem, qty);
  obj.state.crop = null;
  obj.state.timer = null;
  delete obj.state.parched;
  delete obj.state.pecked;
  settleFertility(clock, obj, afterHarvest(fertility, drainOf(crop.id, crop.soilDrain, obj.state.lastCrop ?? null, perkFactor(game.state, 'rich-soil'))), true);
  obj.state.lastCrop = crop.id;
  game.touch(obj);
  game.activity.emit('harvested', { item: crop.harvestItem, qty });
  return { ok: true, crop, qty };
}

export type FertiliseResult = { ok: true; fertility: number } | { ok: false; reason: 'occupied' | 'fertile' | 'manure' };

/** Can the field be manured now? `fertilise` gives the same answer. */
export function checkFertilise(game: Game, obj: PlacedObject<FieldState>): FertiliseResult {
  const clock = game.state.clock;
  if (cropStage(clock, obj.state) !== 'empty') return { ok: false, reason: 'occupied' };
  const fertility = fertilityOf(clock, obj);
  if (fertility >= MAX_FERTILITY) return { ok: false, reason: 'fertile' };
  if (game.count('manure') < MANURE_PER_SPREAD) return { ok: false, reason: 'manure' };
  return { ok: true, fertility: Math.min(MAX_FERTILITY, fertility + MANURE_GAIN) };
}

/**
 * Spreads `MANURE_PER_SPREAD` manure on an empty field: +`MANURE_GAIN` points, up to `MAX_FERTILITY` (above its soil
 * quality too). Refused (nothing changes) while a crop stands, at full fertility, or without enough manure.
 */
export function fertilise(game: Game, obj: PlacedObject<FieldState>): FertiliseResult {
  const check = checkFertilise(game, obj);
  if (!check.ok) return check;
  if (!game.removeItem('manure', MANURE_PER_SPREAD)) return { ok: false, reason: 'manure' };
  settleFertility(game.state.clock, obj, check.fertility, true);
  game.touch(obj);
  game.activity.emit('fertilised', { fertility: check.fertility });
  return check;
}

/** "1:05" / "0:30" for a game-time duration, rounded up to whole seconds. */
export function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
