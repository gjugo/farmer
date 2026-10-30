import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import '../data/animals';
import { listBuildables } from '../data/buildables';
import { CROP_LIST } from '../data/crops';
import { ITEM_LIST, splitIcons } from '../data/items';
import '../data/processing';
import {
  ART_RES,
  artFor,
  COMPOSED,
  cropArt,
  facing,
  fencePiece,
  GATE,
  ICON_ART,
  NE,
  neighbourMask,
  NW,
  pathPiece,
  penFence,
  SE,
  SHADOW,
  SW,
  TEXTURE_ART,
  usedArt,
  type PackManifest,
} from './art';
import { ISO_H, ISO_W } from './iso';

const PACK = resolve(__dirname, '../../public/assets/farm');
const manifest = JSON.parse(readFileSync(resolve(PACK, 'manifest.json'), 'utf8')) as PackManifest;
const assets = new Map(manifest.assets.map((a) => [a.name, a]));

describe('path autotile', () => {
  // Every one of the 16 neighbour masks, with the piece that joins exactly those edges.
  const expected: Record<number, string> = {
    0: 'path_single',
    [NE]: 'path_ne',
    [SE]: 'path_se',
    [SW]: 'path_sw',
    [NW]: 'path_nw',
    [NE | SE]: 'path_ne_se',
    [NE | SW]: 'path_ne_sw',
    [NE | NW]: 'path_ne_nw',
    [SE | SW]: 'path_se_sw',
    [SE | NW]: 'path_se_nw',
    [SW | NW]: 'path_sw_nw',
    [NE | SE | SW]: 'path_ne_se_sw',
    [NE | SE | NW]: 'path_ne_se_nw',
    [NE | SW | NW]: 'path_ne_sw_nw',
    [SE | SW | NW]: 'path_se_sw_nw',
    [NE | SE | SW | NW]: 'path_ne_se_sw_nw',
  };

  it.each(Object.entries(expected))('mask %s → %s', (mask, piece) => {
    expect(pathPiece(Number(mask))).toBe(piece);
    expect(assets.has(piece)).toBe(true);
  });

  it('covers 16 distinct pieces', () => {
    expect(new Set(Array.from({ length: 16 }, (_, m) => pathPiece(m))).size).toBe(16);
  });

  it('reads the four grid neighbours: ne = -y, se = +x, sw = +y, nw = -x', () => {
    const cells = new Set(['5,4', '6,5', '5,6', '4,5']);
    const has = (x: number, y: number) => cells.has(`${x},${y}`);
    expect(neighbourMask(has, 5, 5)).toBe(NE | SE | SW | NW);
    expect(neighbourMask(has, 5, 4)).toBe(0);
    expect(pathPiece(neighbourMask((x, y) => (x === 5 && y === 6) || (x === 6 && y === 5), 5, 5))).toBe('path_se_sw');
  });
});

describe('pen fence', () => {
  it('rings a 4×4 pasture with joined pieces and one gate on the front-left side', () => {
    const parts = penFence(4, 4);
    expect(parts).toHaveLength(12);
    const at = (x: number, y: number) => parts.find((p) => p.x === x && p.y === y)?.art;
    expect(at(0, 0)).toBe(fencePiece(SE | SW)); // back corner
    expect(at(3, 3)).toBe(fencePiece(NE | NW)); // front corner
    expect(at(0, 1)).toBe(fencePiece(NE | SW)); // back-left side runs along y
    expect(at(1, 3)).toBe(GATE); // the gate sits in the side that runs along x
    expect(parts.filter((p) => p.art === GATE)).toHaveLength(1);
    expect(parts.filter((p) => p.front).map((p) => `${p.x},${p.y}`).sort()).toEqual(
      ['0,3', '1,3', '2,3', '3,0', '3,1', '3,2', '3,3'].sort(),
    );
  });
});

describe('facing', () => {
  it('faces the way an animal walks', () => {
    expect(facing(1, 0.2)).toBe('se');
    expect(facing(-1, 0.2)).toBe('nw');
    expect(facing(0.1, 1)).toBe('sw');
    expect(facing(0.1, -1)).toBe('ne');
  });
});

describe('art pack', () => {
  it('sizes the projection from the pack’s 1x ground tile', () => {
    expect(ISO_W).toBe(manifest.tile['1x'].width);
    expect(ISO_H).toBe(manifest.tile['1x'].height);
  });

  it('every pack sprite the game uses is in the manifest, with its files (and shadow) committed', () => {
    for (const name of usedArt()) {
      const asset = assets.get(name);
      expect(asset, name).toBeDefined();
      for (const res of ['1x', '2x'] as const) {
        expect(existsSync(resolve(PACK, asset!.res[res].file)), asset!.res[res].file).toBe(true);
        const shadow = asset!.res[res].shadow;
        if (shadow) expect(existsSync(resolve(PACK, shadow)), shadow).toBe(true);
      }
    }
  });

  it('every texture key the game uses maps to a committed sprite', () => {
    const keys = [
      ...listBuildables().map((b) => b.texture),
      ...Object.keys(TEXTURE_ART),
      ...CROP_LIST.flatMap((c) => ['seeded', 'sprout', 'growing', 'ripe'].map((s) => cropArt(c.id, s)!)),
      ...ITEM_LIST.map((i) => i.id),
    ];
    for (const key of keys) {
      const name = artFor(key);
      const tiles = COMPOSED[name]?.tiles.map((t) => t.art) ?? [name];
      for (const tile of tiles) {
        expect(usedArt(), `${key} → ${tile}`).toContain(tile);
        expect(existsSync(resolve(PACK, assets.get(tile)!.res[ART_RES].file)), tile).toBe(true);
      }
    }
  });

  it('buildables keep footprints that match their pack sprites', () => {
    for (const b of listBuildables()) {
      const fp = assets.get(artFor(b.texture))?.footprint ?? (COMPOSED[artFor(b.texture)] && [COMPOSED[artFor(b.texture)].w, COMPOSED[artFor(b.texture)].h]);
      if (b.id === 'path') continue; // a 1×1 tile
      expect(fp, b.id).toEqual([b.footprint.w, b.footprint.h]);
    }
  });

  it('has an icon for every item, plus coins', () => {
    for (const item of ITEM_LIST) expect(ICON_ART).toContain(item.id);
    expect(ICON_ART).toContain('coins');
  });

  it('uses the shadow suffix of the pack’s files', () => {
    expect(assets.get('chicken_coop')!.res['2x'].shadow).toBe(`2x/buildings/chicken_coop${SHADOW}.png`);
  });
});

describe('splitIcons', () => {
  it('turns item emoji and 💰 into icons and keeps the rest as text', () => {
    expect(splitIcons('+3 🥚 Egg')).toEqual(['+3 ', { icon: 'egg', emoji: '🥚' }, ' Egg']);
    expect(splitIcons('🧀🧈 and 💰')).toEqual([{ icon: 'cheese', emoji: '🧀' }, { icon: 'butter', emoji: '🧈' }, ' and ', { icon: 'coins', emoji: '💰' }]);
    expect(splitIcons('🐔 Chicken')).toEqual(['🐔 Chicken']);
  });
});
