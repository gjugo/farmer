/**
 * The isometric farm art pack in `public/assets/farm/` (see its README.md and manifest.json): which pack
 * sprites the game uses and how its texture keys map to them. Plain TypeScript (no Phaser) so it can be
 * unit-tested; the Boot scene loads what is listed here.
 */

import { SEASONS, type Season } from '../data/seasons';
import { soilBand } from '../logic/soil';

/** Where the pack lives, relative to the page (vite `base: './'`). */
export const ART_BASE = 'assets/farm/';
/** The resolution loaded into Phaser: crisp on phones and when zoomed in. */
export const ART_RES = '2x';
/** 2x sprites are drawn at half size so one world pixel is one 1x pack pixel. */
export const ART_SCALE = 0.5;
/** Texture key suffix of a sprite's shadow layer (`chicken_coop` → `chicken_coop_shadow`, like the pack's files). */
export const SHADOW = '_shadow';

export interface PackRes {
  file: string;
  w?: number;
  h?: number;
  frameWidth?: number;
  frameHeight?: number;
  /** Pixel of the image that sits on the footprint's top corner (animals: the ground under them). */
  anchor: [number, number];
  origin: [number, number];
  shadow?: string;
}

export interface PackAnimation {
  key: string;
  start: number;
  end: number;
  fps: number;
}

export interface PackAsset {
  name: string;
  category: string;
  type: 'image' | 'spritesheet';
  footprint?: [number, number];
  res: Record<'1x' | '2x', PackRes>;
  animations?: PackAnimation[];
}

export interface PackManifest {
  tile: Record<'1x' | '2x', { width: number; height: number }>;
  assets: PackAsset[];
}

// Ground ------------------------------------------------------------------------

export const GRASS = ['grass_0', 'grass_1', 'grass_2'] as const;
export const UNOWNED = ['unowned_0', 'unowned_1'] as const;
export const CURSOR = { normal: 'overlay_cursor', ok: 'overlay_cursor_ok', bad: 'overlay_cursor_bad' } as const;
export const SOIL = { dry: 'soil_tilled_x', wet: 'soil_watered_x' } as const;

/** Grass variant of a tile: a fixed scatter so the ground looks the same every load. */
export function grassArt(x: number, y: number): string {
  return GRASS[(x * 7 + y * 13 + ((x * y) % 5)) % GRASS.length];
}

/**
 * Rich soil grows lusher grass: its tiles are drawn with this tint (a multiply: a touch greener and deeper), in every
 * season. Normal and poor ground are drawn as they are.
 */
export const RICH_GROUND_TINT = 0xd4ecc4;

/** The tint of a ground tile of soil quality `quality` (percentage points, see `src/logic/soil.ts`). */
export function groundTint(quality: number): number {
  return soilBand(quality) === 'rich' ? RICH_GROUND_TINT : 0xffffff;
}

/** Locked land: mostly the dark tile, about one in four overgrown. */
export function unownedArt(x: number, y: number): string {
  return UNOWNED[hash(x, y) % 4 === 0 ? 1 : 0];
}

/** A small deterministic hash of a tile, for scattering art without a save. */
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Paths and fences --------------------------------------------------------------

/** Neighbour bits of an autotiled cell, in the pack's naming order. */
export const NE = 1; // toward -y
export const SE = 2; // toward +x
export const SW = 4; // toward +y
export const NW = 8; // toward -x

const EDGES: [number, string][] = [
  [NE, 'ne'],
  [SE, 'se'],
  [SW, 'sw'],
  [NW, 'nw'],
];

/** The neighbour mask of cell (x, y) given which cells belong to the same network. */
export function neighbourMask(has: (x: number, y: number) => boolean, x: number, y: number): number {
  return (has(x, y - 1) ? NE : 0) | (has(x + 1, y) ? SE : 0) | (has(x, y + 1) ? SW : 0) | (has(x - 1, y) ? NW : 0);
}

function joined(prefix: string, mask: number, alone: string): string {
  const edges = EDGES.filter(([bit]) => mask & bit).map(([, name]) => name);
  return `${prefix}${edges.length ? edges.join('_') : alone}`;
}

/** The path piece that joins the given neighbours (`path_single` when there are none). */
export function pathPiece(mask: number): string {
  return joined('path_', mask & 15, 'single');
}

/** The fence piece whose rails reach the given neighbours (`fence_post` when there are none). */
export function fencePiece(mask: number): string {
  return joined('fence_', mask & 15, 'post');
}

/** A fence piece of a pen: tile inside the pen, pack sprite, and whether it stands at the front (over the animals). */
export interface FencePart {
  x: number;
  y: number;
  art: string;
  front: boolean;
}

/** The gate of a pen: in the front-left side, which runs along x. */
export const GATE = 'gate_se_nw_closed';

/**
 * Fences around a w × h pen, one piece on each border tile (the pack's fences run through tile centres),
 * with a gate in the middle of the front-left side.
 */
export function penFence(w: number, h: number): FencePart[] {
  const onRing = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (x === 0 || y === 0 || x === w - 1 || y === h - 1);
  const gateX = Math.floor((w - 1) / 2);
  const parts: FencePart[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!onRing(x, y)) continue;
      const art = x === gateX && y === h - 1 && w > 2 ? GATE : fencePiece(neighbourMask(onRing, x, y));
      parts.push({ x, y, art, front: x === w - 1 || y === h - 1 });
    }
  }
  return parts;
}

// Objects -----------------------------------------------------------------------

/** Game texture keys drawn as one pack sprite. Keys not listed here are pack names themselves. */
export const TEXTURE_ART: Record<string, string> = {
  path: 'path_single',
  coop: 'chicken_coop',
  'feed-mill': 'feed_mill_static',
  dairy: 'dairy',
  bakery: 'bakery',
  loom: 'weaving_hut',
  'sale-sign': 'for_sale_sign',
  farmhouse: 'farmhouse',
  granary: 'granary_1',
  storehouse: 'storehouse_1',
  woodcutter: 'woodcutter_lodge',
  quarry: 'quarry',
  mine: 'mine',
};

/** Storage buildings have a sprite per level, e.g. `granary_2`; the build preview is level 1. */
export const STORAGE_ART = { granary: 3, storehouse: 3 } as const;

/** The sprite of a storage building at `level` (clamped to the levels drawn). */
export function storageArt(type: keyof typeof STORAGE_ART, level: number): string {
  return `${type}_${Math.max(1, Math.min(STORAGE_ART[type], Math.floor(level) || 1))}`;
}

/**
 * Game textures composed at boot from pack tiles laid out on a w × h footprint (nothing drawn by hand):
 * fields are tilled soil, a pasture is grass inside its fence (the fence alone is drawn per piece in the farm,
 * so animals can walk between its back and front; the composed one is the build preview).
 */
export interface Composed {
  w: number;
  h: number;
  tiles: { x: number; y: number; art: string }[];
}

function fill(w: number, h: number, art: (x: number, y: number) => string): Composed['tiles'] {
  return Array.from({ length: w * h }, (_, i) => ({ x: i % w, y: Math.floor(i / w), art: art(i % w, Math.floor(i / w)) }));
}

export const PASTURE_SIZE = { w: 4, h: 4 } as const;

export const COMPOSED: Record<string, Composed> = {
  field: { w: 2, h: 2, tiles: fill(2, 2, () => SOIL.dry) },
  'field-watered': { w: 2, h: 2, tiles: fill(2, 2, () => SOIL.wet) },
  'pasture-grass': { ...PASTURE_SIZE, tiles: fill(PASTURE_SIZE.w, PASTURE_SIZE.h, (x, y) => GRASS[(x + 2 * y) % 2 ? 1 : 0]) },
  pasture: {
    ...PASTURE_SIZE,
    tiles: [
      ...fill(PASTURE_SIZE.w, PASTURE_SIZE.h, (x, y) => GRASS[(x + 2 * y) % 2 ? 1 : 0]),
      ...penFence(PASTURE_SIZE.w, PASTURE_SIZE.h).map(({ x, y, art }) => ({ x, y, art })),
    ],
  },
};

/** The pack sprite (or composed texture) behind a game texture key. */
export function artFor(key: string): string {
  return TEXTURE_ART[key] ?? key;
}

/** Growth stage of a crop → the pack's stage sprite. */
const CROP_STAGES = { seeded: '0_seeded', sprout: '1_sprout', growing: '2_growing', ripe: '3_ripe' } as const;
export const CROP_ART_IDS = ['wheat', 'carrot', 'corn'] as const;

/** One tile's worth of a crop at a stage, e.g. `corn_2_growing`; null for an empty field or a crop without art. */
export function cropArt(cropId: string, stage: string): string | null {
  if (!(CROP_ART_IDS as readonly string[]).includes(cropId) || !Object.hasOwn(CROP_STAGES, stage)) return null;
  return `${cropId}_${CROP_STAGES[stage as keyof typeof CROP_STAGES]}`;
}

export const ANIMAL_ART = ['chicken', 'cow', 'sheep'] as const;
export type Facing = 'se' | 'sw' | 'ne' | 'nw';

/** Which way something walking by (dx, dy) grid units faces. */
export function facing(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'se' : 'nw';
  return dy >= 0 ? 'sw' : 'ne';
}

/** The farmer's sprite sheet: `farmer_<anim>_<facing>` animations. */
export const FARMER_ART = 'farmer';
export type FarmerAnim = 'idle' | 'sit' | 'walk' | 'plough' | 'plant' | 'harvest' | 'build' | 'feed';

/** Feed mill body and its turning sails (same canvas and anchor). */
export const MILL = { body: 'feed_mill', sails: 'feed_mill_sails', spin: 'feed_mill_sails_spin' } as const;

/** Item icons in the pack: every item of the game, plus coins for money. */
export const ICON_ART = ['egg', 'milk', 'wool', 'feed', 'cheese', 'butter', 'bread', 'cloth', 'wheat', 'carrot', 'corn', 'wood', 'stone', 'iron', 'manure', 'coins'] as const;

/** URL of an item icon for the HTML overlay (1x is plenty for a 24 px icon on a 3x screen). */
export function iconUrl(name: string): string {
  return `${ART_BASE}1x/icons/${name}.png`;
}

/** Stock piles in the yards of the granaries, storehouses and the farmhouse (see `src/features/storage/piles.ts`). */
export const PILE_ART = ['crops', 'animal', 'feed', 'goods', 'wood', 'stone', 'iron', 'house_goods', 'house_materials'] as const;
/** Fill stages drawn per pile: 1 (a quarter) to 4 (full); stage 0 draws nothing. */
export const PILE_ART_STAGES = 4;

/** The sprite of a pile at a fill stage, e.g. `pile_wood_3`; null when nothing is drawn (stage 0, or a pile without art). */
export function pileArt(kind: string, stage: number): string | null {
  if (!(PILE_ART as readonly string[]).includes(kind) || !Number.isInteger(stage) || stage < 1) return null;
  return `pile_${kind}_${Math.min(PILE_ART_STAGES, stage)}`;
}

/** Scenery standing on locked land (gone once the land is bought). */
export const SCENERY = ['tree_oak', 'tree_apple', 'tree_pine', 'bush', 'bush_berry', 'rock_small', 'rock_large'] as const;
/** A small decorative pond on locked land (no gameplay); scattered apart from the other scenery. */
export const POND = 'pond';
/** Share of locked tiles that get a tree, bush or rock, and (of the rest) per mille that get a pond. */
export const SCENERY_CHANCE = 0.07;
export const POND_PER_MILLE = 14;

/** The scenery a tile would carry if it is locked land away from the farm, from a fixed seed: null for none. */
export function sceneryArt(x: number, y: number): string | null {
  if ((hash(x, y, 7) % 1000) / 1000 < SCENERY_CHANCE) return SCENERY[hash(x, y, 11) % SCENERY.length];
  return hash(x, y, 13) % 1000 < POND_PER_MILLE ? POND : null;
}

// Seasons -----------------------------------------------------------------------

/**
 * Sprites drawn in four seasonal versions, `<name>_<season>`: the ground (grass, locked land, every path piece,
 * soil) and the scenery. Fields and the pasture are composed per season from these at boot.
 */
export const SEASONAL_ART: readonly string[] = [
  ...GRASS,
  ...UNOWNED,
  ...Array.from({ length: 16 }, (_, m) => pathPiece(m)),
  SOIL.dry,
  SOIL.wet,
  ...SCENERY,
  POND,
];
const seasonal = new Set<string>(SEASONAL_ART);

/** Buildings with a `<name>_winter` version (snow on the roof). The art generator makes one for every building. */
const winterOnly = new Set<string>();

/** Notes which buildings the pack has a winter version of: every `buildings` sprite with a `<name>_winter` twin. */
export function noteWinterArt(manifest: PackManifest): void {
  const names = new Set(manifest.assets.map((a) => a.name));
  winterOnly.clear();
  for (const a of manifest.assets) if (a.category === 'buildings' && names.has(`${a.name}_winter`)) winterOnly.add(a.name);
}

const SEASON_SUFFIX = new RegExp(`_(${SEASONS.join('|')})$`);

/**
 * The sprite (or composed texture) to draw for `name` in `season`: `grass_1` → `grass_1_winter`, `farmhouse` →
 * `farmhouse_winter` in winter only, a shadow layer follows its sprite. Names without seasonal art come back as is.
 */
export function seasonalArt(name: string, season: Season): string {
  if (name.endsWith(SHADOW)) return `${seasonalArt(name.slice(0, -SHADOW.length), season)}${SHADOW}`;
  if (seasonal.has(name) || Object.hasOwn(COMPOSED, name)) return `${name}_${season}`;
  return season === 'winter' && winterOnly.has(name) ? `${name}_winter` : name;
}

/** The base name of a seasonal sprite (`grass_1_winter` → `grass_1`); other names come back as is. */
export function baseArt(name: string): string {
  if (name.endsWith(SHADOW)) return `${baseArt(name.slice(0, -SHADOW.length))}${SHADOW}`;
  const m = SEASON_SUFFIX.exec(name);
  if (!m) return name;
  const base = name.slice(0, m.index);
  return seasonal.has(base) || Object.hasOwn(COMPOSED, base) || (m[1] === 'winter' && winterOnly.has(base)) ? base : name;
}

/** Every season's version of the composed textures (fields, pasture), laid out from seasonal tiles. */
export function seasonalComposed(): Record<string, Composed> {
  const out: Record<string, Composed> = {};
  for (const [key, c] of Object.entries(COMPOSED)) {
    for (const season of SEASONS) out[`${key}_${season}`] = { ...c, tiles: c.tiles.map((t) => ({ ...t, art: seasonalArt(t.art, season) })) };
  }
  return out;
}

/** Every pack sprite the game draws; the Boot scene loads these (and their shadows). */
export function usedArt(): string[] {
  const names = new Set<string>([
    ...GRASS,
    ...UNOWNED,
    ...Object.values(CURSOR),
    ...Object.values(SOIL),
    ...Array.from({ length: 16 }, (_, m) => pathPiece(m)),
    ...Array.from({ length: 16 }, (_, m) => fencePiece(m)),
    GATE,
    ...Object.values(TEXTURE_ART),
    MILL.body,
    MILL.sails,
    ...(Object.keys(STORAGE_ART) as (keyof typeof STORAGE_ART)[]).flatMap((t) => Array.from({ length: STORAGE_ART[t] }, (_, i) => storageArt(t, i + 1))),
    ...CROP_ART_IDS.flatMap((c) => Object.keys(CROP_STAGES).map((s) => cropArt(c, s)!)),
    ...ANIMAL_ART,
    FARMER_ART,
    ...ICON_ART,
    ...SCENERY,
    POND,
    ...PILE_ART.flatMap((k) => Array.from({ length: PILE_ART_STAGES }, (_, i) => pileArt(k, i + 1)!)),
  ]);
  // Every season's version of what is used (ground and scenery in four seasons, buildings in winter).
  for (const name of [...names]) for (const season of SEASONS) names.add(seasonalArt(name, season));
  return [...names];
}
