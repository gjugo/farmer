/**
 * The ground under the farm: which tile art each map tile gets and the tint it is drawn with. Fixed by the tile
 * coordinates and the map (not saved). Plain TypeScript (no Phaser) so it can be unit-tested; the Farm scene draws
 * it as one Blitter.
 *
 * - Zones: a forest floor under and beside the map's trees (`FOREST_REACH`), a wet meadow around the pond sites
 *   (`WET_REACH`), meadow everywhere else.
 * - Meadow: plain grass on about 60% of the tiles; the rest are special tiles (clover, flowers, ...) that come in
 *   patches, following low-frequency noise. Winter has its own specials (grass tips in the snow, a small drift).
 * - Tint (a multiply): gentle colour patches from the noise, the soil showing through (rich lusher, poor drier;
 *   stronger than the noise), the zone's shade and locked land darkened and muted.
 */

import { SEASONS, type Season } from '../data/seasons';
import { soilBand } from '../logic/soil';
import { hash, noise } from './noise';

export type GroundZone = 'meadow' | 'forest' | 'wet';

/** Tiles within this many tiles (either axis) of a tree, grown or stump, are forest floor. */
export const FOREST_REACH = 1;
/** Tiles within this many tiles (either axis) of a pond site are wet meadow. */
export const WET_REACH = 2;

interface Weighted {
  name: string;
  weight: number;
}

/** Plain grass: the pack's `grass_0..2`, drawn in every season (paths, soil beds and the pasture share its border). */
export const PLAIN_GRASS = ['grass_0', 'grass_1', 'grass_2'] as const;

/** Special meadow tiles from spring to autumn, with their share of meadow tiles (percent). Plain grass is the rest. */
export const MEADOW_SPECIALS: readonly Weighted[] = [
  { name: 'grass_clover', weight: 8 },
  { name: 'grass_flowers', weight: 8 },
  { name: 'grass_long', weight: 8 },
  { name: 'grass_worn', weight: 5 },
  { name: 'grass_moss', weight: 6 },
  { name: 'grass_stones', weight: 5 },
];
/** Special meadow tiles in winter. */
export const WINTER_SPECIALS: readonly Weighted[] = [
  { name: 'grass_tips', weight: 30 },
  { name: 'grass_drift', weight: 10 },
];
export const FOREST_FLOOR = ['forest_0', 'forest_1', 'forest_2'] as const;
export const WET_MEADOW = ['wet_0', 'wet_1'] as const;

const specials = (season: Season) => (season === 'winter' ? WINTER_SPECIALS : MEADOW_SPECIALS);
const total = (list: readonly Weighted[]) => list.reduce((n, w) => n + w.weight, 0);

/** Every ground tile name drawn in `season` (each with a `<name>_<season>` file in the pack). */
export function groundNames(season: Season): string[] {
  return [...PLAIN_GRASS, ...specials(season).map((s) => s.name), ...FOREST_FLOOR, ...WET_MEADOW];
}

/** Every ground frame of every season, as the pack names them (`grass_clover_summer`), for loading. */
export function groundFrames(season: Season): string[] {
  return groundNames(season).map((name) => `${name}_${season}`);
}

/** Every season's ground frames. */
export const GROUND_FRAMES: readonly string[] = SEASONS.flatMap(groundFrames);

/** The zone of tile (x, y), given where trees (grown or stumps) and pond sites are. Forest wins over wet. */
export function groundZone(x: number, y: number, hasTree: (x: number, y: number) => boolean, isPond: (x: number, y: number) => boolean): GroundZone {
  for (let dy = -FOREST_REACH; dy <= FOREST_REACH; dy++) {
    for (let dx = -FOREST_REACH; dx <= FOREST_REACH; dx++) if (hasTree(x + dx, y + dy)) return 'forest';
  }
  for (let dy = -WET_REACH; dy <= WET_REACH; dy++) {
    for (let dx = -WET_REACH; dx <= WET_REACH; dx++) if (isPond(x + dx, y + dy)) return 'wet';
  }
  return 'meadow';
}

// Noise fields (seeds of `noise`).
const LIGHT = 1;
const HUE = 2;
const PATCH = 3;
const KIND_X = 4;
const KIND_Y = 5;
/** Size, in tiles, of the cells a special tile's kind is drawn from: neighbours share a kind. */
const KIND_CELL = 5;
/** How strongly the patch noise pulls special tiles together (0: salt and pepper). */
const PATCHINESS = 3;

const unit = (x: number, y: number, seed: number) => hash(x, y, seed) / 0x100000000;

function weightedPick(list: readonly Weighted[], u: number): string {
  let left = u * total(list);
  for (const w of list) {
    left -= w.weight;
    if (left < 0) return w.name;
  }
  return list[list.length - 1].name;
}

/** Whether a meadow tile is a special one: about `share` of tiles, gathered into patches by the noise. */
export function isSpecial(x: number, y: number, share: number): boolean {
  const p = Math.max(0, Math.min(1, share + PATCHINESS * share * noise(x, y, PATCH)));
  return unit(x, y, 41) < p;
}

/** The ground tile (base name, e.g. `grass_clover`) of tile (x, y) in `zone` and `season`. */
export function groundVariant(x: number, y: number, zone: GroundZone, season: Season): string {
  if (zone === 'forest') return FOREST_FLOOR[hash(x, y, 23) % FOREST_FLOOR.length];
  if (zone === 'wet') return WET_MEADOW[hash(x, y, 29) % WET_MEADOW.length];
  const list = specials(season);
  if (isSpecial(x, y, total(list) / 100)) {
    // The kind comes from a coarse cell, its edges wobbled by the noise, so a patch is mostly one kind.
    const cx = Math.floor((x + 2.5 * noise(x, y, KIND_X)) / KIND_CELL);
    const cy = Math.floor((y + 2.5 * noise(x, y, KIND_Y)) / KIND_CELL);
    return weightedPick(list, unit(cx, cy, 31));
  }
  return PLAIN_GRASS[hash(x, y, 37) % PLAIN_GRASS.length];
}

// Tints -------------------------------------------------------------------------

export type Rgb = [number, number, number];

export const rgbOf = (tint: number): Rgb => [((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255];
export const tintOf = ([r, g, b]: Rgb): number =>
  (Math.round(Math.min(1, r) * 255) << 16) | (Math.round(Math.min(1, g) * 255) << 8) | Math.round(Math.min(1, b) * 255);

/**
 * How strong the colour patches are: lighter/darker and greener/yellower, each about ±`light` / ±`hue` around the
 * middle. Gentle in autumn and only a faint light/dark on winter snow (no hue: green snow reads as mint).
 */
export const NOISE_STRENGTH: Record<Season, { light: number; hue: number }> = {
  spring: { light: 0.035, hue: 0.035 },
  summer: { light: 0.035, hue: 0.035 },
  autumn: { light: 0.025, hue: 0.02 },
  winter: { light: 0.012, hue: 0 },
};

/** The colour-patch tint of tile (x, y): a multiply of at most about ±7% around its middle. */
export function noiseTint(x: number, y: number, season: Season): Rgb {
  const { light, hue } = NOISE_STRENGTH[season];
  const l = 1 - light + light * noise(x, y, LIGHT); // 1 - 2·light .. 1
  const h = hue * noise(x, y, HUE); // > 0 yellower (less blue), < 0 greener (less red)
  return [l * (1 + Math.min(0, h)), l, l * (1 - Math.max(0, h))];
}

/**
 * Soil showing through the grass: rich ground lusher and greener (deeper while the grass grows, a softer olive on
 * autumn's gold, a faint cool shade on winter's snow), poor ground drier and yellower, normal as it is.
 */
export const SOIL_TINT: Record<'rich' | 'poor', Record<Season, number>> = {
  rich: { spring: 0xd4ecc4, summer: 0xd4ecc4, autumn: 0xe0e8c8, winter: 0xe6ecf2 },
  poor: { spring: 0xf8e6b8, summer: 0xf8e6b8, autumn: 0xf8e4c0, winter: 0xf6f0e2 },
};

/** The soil tint of a tile of soil quality `quality` (percentage points, see `src/logic/soil.ts`) in `season`. */
export function soilTint(quality: number, season: Season): number {
  const band = soilBand(quality);
  return band === 'normal' ? 0xffffff : SOIL_TINT[band][season];
}

/** The forest floor is a darker green, the wet meadow lusher and darker (frosty and cold in winter). */
export const ZONE_TINT: Record<GroundZone, Record<Season, number>> = {
  meadow: { spring: 0xffffff, summer: 0xffffff, autumn: 0xffffff, winter: 0xffffff },
  forest: { spring: 0xd8e4d4, summer: 0xd8e4d4, autumn: 0xe2dcd2, winter: 0xe4e8ee },
  wet: { spring: 0xdcecdc, summer: 0xdcecdc, autumn: 0xe4e8d8, winter: 0xeef4fc },
};

/** Locked land: darkened and muted (green taken down most) over whatever ground is there. */
export const LOCKED_TINT: Record<Season, number> = {
  spring: 0xc4b4c8,
  summer: 0xc4b4c8,
  autumn: 0xc8bcc4,
  winter: 0xd6dcea,
};

/**
 * The zone shade of tile (x, y): its own zone's tint averaged with its 8 neighbours' (its own counting 4 times), so the
 * forest floor and wet meadow fade out over a tile instead of stopping at a tile edge.
 */
export function zoneShade(x: number, y: number, zoneAt: (x: number, y: number) => GroundZone, season: Season): Rgb {
  const sum: Rgb = [0, 0, 0];
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const w = dx === 0 && dy === 0 ? 4 : 1;
      const t = rgbOf(ZONE_TINT[zoneAt(x + dx, y + dy)][season]);
      for (let c = 0; c < 3; c++) sum[c] += t[c] * w;
      n += w;
    }
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/** The tint a ground tile is drawn with: noise × soil × zone shade × locked, as one multiply. */
export function groundTint(x: number, y: number, quality: number, zone: GroundZone, locked: boolean, season: Season, shade?: Rgb): number {
  const parts = [noiseTint(x, y, season), rgbOf(soilTint(quality, season)), shade ?? rgbOf(ZONE_TINT[zone][season])];
  if (locked) parts.push(rgbOf(LOCKED_TINT[season]));
  return tintOf(parts.reduce((a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]]));
}

/** What the Farm scene draws on a tile: the frame (`grass_clover_summer`), its tint and the tile's zone. */
export interface GroundLook {
  art: string;
  tint: number;
  zone: GroundZone;
}

/** What tile (x, y) shows; `zoneAt` (the zone of any tile) feathers the zone shade into the neighbours. */
export function groundLook(
  x: number,
  y: number,
  quality: number,
  zone: GroundZone,
  locked: boolean,
  season: Season,
  zoneAt?: (x: number, y: number) => GroundZone,
): GroundLook {
  const shade = zoneAt ? zoneShade(x, y, zoneAt, season) : undefined;
  return { art: `${groundVariant(x, y, zone, season)}_${season}`, tint: groundTint(x, y, quality, zone, locked, season, shade), zone };
}
