import {
  FALLOW_GAIN_PER_DAY,
  MAX_FERTILITY,
  SAME_CROP_DRAIN,
  SOIL_CELL,
  SOIL_QUALITY,
  SOIL_SEED,
  YIELD_BASE,
  YIELD_PER_FERTILITY,
  type SoilBand,
} from '../data/soil';
import { DAY_MS, MAP_HEIGHT, MAP_WIDTH, START_LAND, START_LAYOUT } from './constants';

/**
 * Soil rules: a fixed soil-quality layer over the whole map, and how a field's fertility drains with harvests,
 * recovers while it lies empty and sets the yield. Pure functions of numbers and game times: nothing here is
 * scheduled, so ×1, ×60 and offline catch-up give the same soil.
 */

/** A small deterministic hash of a lattice point. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in 0..1 at a point, smoothly interpolated between random values on a lattice `cell` tiles apart. */
function valueNoise(px: number, py: number, cell: number, seed: number): number {
  const gx = px / cell;
  const gy = py / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smooth(gx - x0);
  const ty = smooth(gy - y0);
  const v = (x: number, y: number) => (hash(x, y, seed) % 10_000) / 10_000;
  const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
  const bottom = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
  return top + (bottom - top) * ty;
}

/** Centre (in tiles) and reach of the rich patch on the starting land: under and just in front of the starting fields. */
export const START_PATCH = { x: START_LAYOUT.x + 2.5, y: START_LAYOUT.y + 1.5, radius: 7 } as const;

/** How strongly the starting land is pulled toward normal ground (0 none, 1 all normal). */
const START_CALM = 0.65;
/** The pull fades out over this many tiles beyond the starting land. */
const START_FADE = 4;
/** Bands by raw value: above `RICH_ABOVE` rich, below `POOR_BELOW` poor, normal between. */
const RICH_ABOVE = 0.66;
const POOR_BELOW = 0.34;

/** The raw soil value (0..1) of a tile: two octaves of blobs, calmed on the starting land, plus its rich patch. */
function rawSoil(x: number, y: number): number {
  const px = x + 0.5;
  const py = y + 0.5;
  let v = 0.7 * valueNoise(px, py, SOIL_CELL, SOIL_SEED) + 0.3 * valueNoise(px, py, SOIL_CELL / 2, SOIL_SEED + 1);
  // Distance outside the starting land (0 inside).
  const dx = Math.max(START_LAND.x - px, 0, px - (START_LAND.x + START_LAND.w));
  const dy = Math.max(START_LAND.y - py, 0, py - (START_LAND.y + START_LAND.h));
  const calm = START_CALM * smooth(Math.max(0, 1 - Math.hypot(dx, dy) / START_FADE));
  v += (0.5 - v) * calm;
  const d = Math.hypot(px - START_PATCH.x, py - START_PATCH.y);
  v += 0.45 * smooth(Math.max(0, 1 - d / START_PATCH.radius));
  return v;
}

export function bandOf(raw: number): SoilBand {
  return raw > RICH_ABOVE ? 'rich' : raw < POOR_BELOW ? 'poor' : 'normal';
}

let layer: Uint8Array | null = null;

/** The whole map's soil quality, row-major, computed once. */
function soilLayer(): Uint8Array {
  if (layer) return layer;
  layer = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  for (let y = 0; y < MAP_HEIGHT; y++) for (let x = 0; x < MAP_WIDTH; x++) layer[y * MAP_WIDTH + x] = SOIL_QUALITY[bandOf(rawSoil(x, y))];
  return layer;
}

/** Soil quality (percentage points) of a tile; normal off the map. */
export function soilAt(x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return SOIL_QUALITY.normal;
  return soilLayer()[y * MAP_WIDTH + x];
}

/** The band a quality falls in: the nearest of rich, normal and poor. */
export function soilBand(quality: number): SoilBand {
  if (quality >= (SOIL_QUALITY.rich + SOIL_QUALITY.normal) / 2) return 'rich';
  if (quality < (SOIL_QUALITY.normal + SOIL_QUALITY.poor) / 2) return 'poor';
  return 'normal';
}

/** The average soil quality of an area's tiles: where a new field's fertility starts, and where resting brings it back to. */
export function areaSoil(area: { x: number; y: number; w: number; h: number }): number {
  let sum = 0;
  for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) sum += soilAt(x, y);
  return sum / Math.max(1, area.w * area.h);
}

const clampFertility = (f: number) => Math.min(MAX_FERTILITY, Math.max(0, f));

/**
 * Fertility at `now` of a field that had `fertility` when it began resting at `restingSince` (null while a crop
 * grows: no recovery). It regains `FALLOW_GAIN_PER_DAY` per game day up to its soil quality; above that (after
 * manure) it stays where it is.
 */
export function restedFertility(fertility: number, restingSince: number | null, quality: number, now: number): number {
  const f = clampFertility(fertility);
  if (restingSince === null || f >= quality || now <= restingSince) return f;
  return Math.min(quality, f + (FALLOW_GAIN_PER_DAY * (now - restingSince)) / DAY_MS);
}

/**
 * Harvest yield of a crop of `harvestQty` from a field at `fertility`: ×0.5 on bare soil up to ×1.25 at 100%, times
 * `bonus` (Green thumb).
 */
export function yieldAt(harvestQty: number, fertility: number, bonus = 1): number {
  return Math.round(harvestQty * bonus * (YIELD_BASE + (YIELD_PER_FERTILITY * clampFertility(fertility)) / 100));
}

/**
 * Points a harvest of a crop that drains `drain` takes from a field whose last harvest was `lastCrop`: double for the
 * same crop again, times `factor` (Rich soil).
 */
export function drainOf(cropId: string, drain: number, lastCrop: string | null, factor = 1): number {
  return (cropId === lastCrop ? drain * SAME_CROP_DRAIN : drain) * factor;
}

/** Fertility after a harvest drained it. */
export function afterHarvest(fertility: number, drain: number): number {
  return clampFertility(fertility - drain);
}
