/**
 * The isometric farm art pack in `public/assets/farm/` (see its README.md and manifest.json): which pack
 * sprites the game uses and how its texture keys map to them. Plain TypeScript (no Phaser) so it can be
 * unit-tested; the Boot scene loads what is listed here.
 */

import { SEASONS, type Season } from '../data/seasons';
import type { JobKind } from '../data/workers';
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
 * Rich soil grows lusher grass: its tiles are drawn with this tint (a multiply). Greener and deeper while the grass
 * grows, a softer olive on autumn's gold, and only a faint cool shade on winter's snow (green there reads as mint).
 * Normal and poor ground are drawn as they are.
 */
export const RICH_GROUND_TINT: Record<Season, number> = {
  spring: 0xd4ecc4,
  summer: 0xd4ecc4,
  autumn: 0xe0e8c8,
  winter: 0xe6ecf2,
};

/** The tint of a ground tile of soil quality `quality` (percentage points, see `src/logic/soil.ts`) in `season`. */
export function groundTint(quality: number, season: Season): number {
  return soilBand(quality) === 'rich' ? RICH_GROUND_TINT[season] : 0xffffff;
}

/** A ground tile's tint `tint` (from `groundTint`) as drawn in `season` instead. */
export function seasonalGroundTint(tint: number, season: Season): number {
  return Object.values(RICH_GROUND_TINT).includes(tint) ? RICH_GROUND_TINT[season] : tint;
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
  const edges = edgeNames(mask);
  return `${prefix}${edges.length ? edges.join('_') : alone}`;
}

/** The path piece that joins the given neighbours (`path_single` when there are none). */
export function pathPiece(mask: number): string {
  return joined('path_', mask & 15, 'single');
}

/** The edges in a neighbour mask, by name (`NE | SW` → `['ne', 'sw']`). */
export function edgeNames(mask: number): string[] {
  return EDGES.filter(([bit]) => mask & bit).map(([, name]) => name);
}

/** The grid step across each edge. */
export const EDGE_STEP: Record<number, readonly [number, number]> = { [NE]: [0, -1], [SE]: [1, 0], [SW]: [0, 1], [NW]: [-1, 0] };

/** What grass fringes hang over: a path's dirt, or a field's soil bed (a lower strip, clear of the crops). */
export const FRINGE_KINDS = ['path', 'field'] as const;
export type FringeKind = (typeof FRINGE_KINDS)[number];

/** The strip of grass tufts along one edge (`NE`, `SE`, `SW` or `NW`) of a path or field tile, e.g. `fringe_path_ne`. */
export function fringeArt(kind: FringeKind, edge: number): string {
  return `fringe_${kind}_${edgeNames(edge)[0]}`;
}

/** Every fringe strip: one per kind and edge. */
export const FRINGE_ART: readonly string[] = FRINGE_KINDS.flatMap((kind) => EDGES.map(([bit]) => fringeArt(kind, bit)));

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
  malthouse: 'malthouse',
  brewery: 'brewery',
  tailor: 'tailor',
  blacksmith: 'blacksmith',
  'sale-sign': 'for_sale_sign',
  'trader-wagon': 'trader_wagon',
  farmhouse: 'farmhouse',
  granary: 'granary_1',
  storehouse: 'storehouse_1',
  woodcutter: 'woodcutter_lodge',
  quarry: 'quarry',
  mine: 'mine',
  cottage: 'cottage',
  well: 'well',
  scarecrow: 'scarecrow',
  kennel: 'kennel',
  'veg-patch': 'veg_patch',
  'hen-run': 'hen_run',
  orchard: 'orchard',
  oxbarn: 'ox_barn',
};

/** The crows that eat on a field (see `src/features/hazards`): two frames, head up and pecking. */
export const CROW_ART = ['crow_0', 'crow_1'] as const;

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
export const CROP_ART_IDS = ['wheat', 'carrot', 'corn', 'potato', 'barley', 'flax', 'cabbage', 'pumpkin'] as const;
/** Crops that stand in the field in winter have a frosted `<crop>_<stage>_winter` version of every stage. */
export const WINTER_CROP_ART_IDS = ['cabbage'] as const;

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
export type FarmerAnim = 'idle' | 'sit' | 'walk' | JobKind | `carry_${Load}`;

/** The animation for each job's work, with the tool he holds (`tools/ludo/README.md`, "Tools"). */
export const WORK_ANIM: Record<JobKind, FarmerAnim> = {
  plough: 'plough', // hoe
  plant: 'plant', // seed bag
  harvest: 'harvest', // sickle
  collect: 'collect', // basket
  feed: 'feed', // feed bucket
  fertilise: 'fertilise', // pitchfork
  load: 'load', // sack
  build: 'build', // hammer
  chop: 'chop', // axe
  quarry: 'quarry', // pickaxe
  mine: 'mine', // pickaxe
  haul: 'walk', // beside the ox, or loading and unloading the cart (src/features/haul)
};

/** What a farmer can carry on a walk: each has its own walk, `carry_<load>` (`tools/ludo/README.md`, "Carrying"). */
export const LOADS = ['sack', 'basket', 'bucket', 'logs', 'stone'] as const;
export type Load = (typeof LOADS)[number];
/** The walk to the work (`out`) or home from it (`back`). */
export type Trip = 'out' | 'back';
/** A trip's load: always this one, nothing (null, the empty-handed walk), or `'item'`: whatever `ITEM_LOAD` gives the item it carries. */
export type CarryRule = Load | 'item' | null;

/**
 * What each job's farmer carries out and back. Visual only: the goods already moved when the job started, so this
 * goes by the job and its workplace, never the stock. `'item'` trips look up the item (`carriedItem` in
 * `src/features/workers`): the pen's product, the building's output, or a construction site's main material.
 */
export const CARRY: Record<JobKind, Record<Trip, CarryRule>> = {
  plough: { out: null, back: null },
  plant: { out: null, back: null },
  harvest: { out: null, back: 'sack' }, // the crop
  collect: { out: null, back: 'item' }, // eggs, milk, wool, goods or waiting materials
  feed: { out: 'sack', back: null },
  fertilise: { out: 'sack', back: null }, // manure
  load: { out: 'sack', back: null }, // the recipe's inputs
  build: { out: 'item', back: null }, // wood, else stone
  chop: { out: null, back: 'item' },
  quarry: { out: null, back: 'item' },
  mine: { out: null, back: 'item' },
  haul: { out: null, back: null }, // the goods ride on the oxcart
};

/** The load an item is carried in; any item not listed goes in a sack. Iron shares the stone block. */
export const ITEM_LOAD: Partial<Record<string, Load>> = { egg: 'basket', milk: 'bucket', wood: 'logs', stone: 'stone', iron: 'stone' };

/** The load of a job's trip, given the item an `'item'` trip carries (null: unknown, a sack). */
export function carryLoad(kind: JobKind, trip: Trip, item: string | null = null): Load | null {
  const rule = CARRY[kind]?.[trip] ?? null;
  if (rule !== 'item') return rule;
  return (item && ITEM_LOAD[item]) || 'sack';
}

/** The ox of an ox barn: `ox_<idle|walk>_<facing>` animations, like the farm animals. */
export const OX_ART = 'ox';
/** The oxcart, one sprite per facing: `cart_se`, `cart_sw`, `cart_ne`, `cart_nw`. */
export const CART_ART = 'cart';
export const CART_FACINGS: readonly Facing[] = ['se', 'sw', 'ne', 'nw'];

export function cartArt(f: Facing): string {
  return `${CART_ART}_${f}`;
}

/**
 * What lies on a cart carrying `load`: logs, stone or iron (the storehouse piles), or sacks (the granary's feed pile)
 * for every good; a bigger pile past half a load. Null when the cart is empty.
 */
export function cartLoadArt(load: Record<string, number>): string | null {
  const entries = Object.entries(load).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  const [item] = entries.sort((a, b) => b[1] - a[1])[0];
  const kind = item === 'wood' || item === 'stone' || item === 'iron' ? item : 'feed';
  const total = entries.reduce((n, [, q]) => n + q, 0);
  return pileArt(kind, total > 10 ? 2 : 1);
}

/** Feed mill body and its turning sails (same canvas and anchor). */
export const MILL = { body: 'feed_mill', sails: 'feed_mill_sails', spin: 'feed_mill_sails_spin' } as const;

/** Item icons in the pack: every item of the game, plus coins for money. */
export const ICON_ART = [
  'egg', 'milk', 'wool', 'feed', 'cheese', 'butter', 'bread', 'cloth', 'malt', 'ale', 'linen', 'clothes', 'wheat', 'carrot',
  'corn', 'potato', 'barley', 'flax', 'cabbage', 'pumpkin', 'apple', 'wood', 'stone', 'iron', 'manure', 'tools', 'coins',
] as const;

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

/** Decorative scenery standing on locked land (gone once the land is bought). Trees and rocks are real: see below. */
export const SCENERY = ['bush', 'bush_berry'] as const;
/** A small decorative pond on locked land (no gameplay); scattered apart from the other scenery. */
export const POND = 'pond';
/** Share of locked tiles that get a bush, and (of the rest) per mille that get a pond. */
export const SCENERY_CHANCE = 0.02;
export const POND_PER_MILLE = 5;

/** The scenery a tile would carry if it is locked land away from the farm, from a fixed seed: null for none. */
export function sceneryArt(x: number, y: number): string | null {
  if ((hash(x, y, 7) % 1000) / 1000 < SCENERY_CHANCE) return SCENERY[hash(x, y, 11) % SCENERY.length];
  return hash(x, y, 13) % 1000 < POND_PER_MILLE ? POND : null;
}

// Ground decorations (src/scenes/decor.ts, drawn by src/features/decor) -------------------

/** All-year decorations over the grass, drawn in each season's look (`<name>_<season>`). */
export const TUFT_ART = ['decor_tuft_0', 'decor_tuft_1'] as const;
export const STONE_ART = ['decor_stones_0', 'decor_stones_1'] as const;
/** Each season's own decorations; the last of each list never leads a cell (see `decorArt`). */
export const SEASON_DECOR: Record<Season, readonly string[]> = {
  spring: ['decor_daisies', 'decor_buttercups', 'decor_cornflowers', 'decor_puddle'],
  summer: ['decor_tallgrass_0', 'decor_tallgrass_1', 'decor_poppies'],
  autumn: ['decor_mushrooms_0', 'decor_mushrooms_1', 'decor_leaves_0', 'decor_leaves_1'],
  winter: ['decor_twigs_0', 'decor_twigs_1', 'decor_snowdrift'],
};
/** Undergrowth at forest edges, each in four seasons: ferns brown in autumn, all of it snowy in winter. */
export const FERN_ART = ['fern_0', 'fern_1'] as const;
export const LOG_ART = 'fallen_log';
/** Every decoration sprite: the seasonal ones by base name, plus the bushes the undergrowth shares with the scenery. */
export const DECOR_ART: readonly string[] = [
  ...TUFT_ART,
  ...STONE_ART,
  ...FERN_ART,
  LOG_ART,
  ...SEASONS.flatMap((s) => SEASON_DECOR[s]),
  ...SCENERY,
];

// Map resources (src/logic/maplayer.ts, drawn by src/features/nature) ----------------------

/** Grown trees: mostly oaks and pines, the odd apple tree. */
export const TREE_ART = ['tree_oak', 'tree_pine', 'tree_oak', 'tree_pine', 'tree_apple'] as const;
export const STUMP_ART = 'tree_stump';
/** Deposit tiles, full (a variant per tile) and used up. */
export const DEPOSIT_ART = {
  stone: { full: ['outcrop_0', 'outcrop_1', 'outcrop_2'], spent: 'outcrop_spent' },
  iron: { full: ['vein_0', 'vein_1'], spent: 'vein_spent' },
} as const;

/** The sprite of a tree tile: which kind of tree stands there is fixed by the tile; a stump once felled. */
export function treeArt(x: number, y: number, stump: boolean): string {
  return stump ? STUMP_ART : TREE_ART[hash(x, y, 17) % TREE_ART.length];
}

/** The sprite of a deposit tile, e.g. `outcrop_1`, or the used-up rubble. */
export function depositArt(kind: keyof typeof DEPOSIT_ART, x: number, y: number, spent: boolean): string {
  const art = DEPOSIT_ART[kind];
  return spent ? art.spent : art.full[hash(x, y, 19) % art.full.length];
}

/** House gardens drawn in four seasons (the vegetable patch is bare in winter); the others have a winter version only. */
export const GARDEN_SEASONAL_ART = ['veg_patch'] as const;
/** The orchard's two trees: the map's apple tree, in its seasons. */
export const ORCHARD_TREE = 'tree_apple';

/** Every map-resource sprite, each in four seasons. */
export const MAP_ART: readonly string[] = [
  ...new Set<string>([...TREE_ART, STUMP_ART, ...Object.values(DEPOSIT_ART).flatMap((d) => [...d.full, d.spent])]),
];

// Seasons -----------------------------------------------------------------------

/**
 * Sprites drawn in four seasonal versions, `<name>_<season>`: the ground (grass, locked land, every path piece,
 * the grass fringes, soil), the scenery and the map's trees and deposits. Fields and the pasture are composed per season from these at boot.
 */
export const SEASONAL_ART: readonly string[] = [
  ...GRASS,
  ...UNOWNED,
  ...Array.from({ length: 16 }, (_, m) => pathPiece(m)),
  ...FRINGE_ART,
  SOIL.dry,
  SOIL.wet,
  ...SCENERY,
  POND,
  ...MAP_ART,
  ...GARDEN_SEASONAL_ART,
  ...TUFT_ART,
  ...STONE_ART,
  ...FERN_ART,
  LOG_ART,
];
const seasonal = new Set<string>(SEASONAL_ART);

/**
 * Sprites with a `<name>_winter` version only: buildings (snow on the roof; the art generator makes one for every
 * building, see `noteWinterArt`) and the stages of crops that stand in winter (`WINTER_CROP_ART_IDS`).
 */
const winterOnly = new Set<string>();
const winterCrops = (): string[] => WINTER_CROP_ART_IDS.flatMap((c) => Object.keys(CROP_STAGES).map((s) => cropArt(c, s)!));
for (const name of winterCrops()) winterOnly.add(name);

/** Notes which buildings the pack has a winter version of: every `buildings` sprite with a `<name>_winter` twin. */
export function noteWinterArt(manifest: PackManifest): void {
  const names = new Set(manifest.assets.map((a) => a.name));
  winterOnly.clear();
  for (const name of winterCrops()) winterOnly.add(name);
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
    ...FRINGE_ART,
    GATE,
    ...Object.values(TEXTURE_ART),
    MILL.body,
    MILL.sails,
    ...(Object.keys(STORAGE_ART) as (keyof typeof STORAGE_ART)[]).flatMap((t) => Array.from({ length: STORAGE_ART[t] }, (_, i) => storageArt(t, i + 1))),
    ...CROP_ART_IDS.flatMap((c) => Object.keys(CROP_STAGES).map((s) => cropArt(c, s)!)),
    ...ANIMAL_ART,
    OX_ART,
    ...CART_FACINGS.map(cartArt),
    FARMER_ART,
    ...CROW_ART,
    ...ICON_ART,
    ...SCENERY,
    POND,
    ...DECOR_ART,
    ...MAP_ART,
    ...PILE_ART.flatMap((k) => Array.from({ length: PILE_ART_STAGES }, (_, i) => pileArt(k, i + 1)!)),
  ]);
  // Every season's version of what is used (ground and scenery in four seasons, buildings in winter).
  for (const name of [...names]) for (const season of SEASONS) names.add(seasonalArt(name, season));
  return [...names];
}
