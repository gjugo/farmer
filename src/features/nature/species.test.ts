import { describe, expect, it } from 'vitest';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from '../../logic/constants';
import { blockAt, depositAt, MAP_BLOCKS, newMapLayer, treeAt, type MapLayer } from '../../logic/maplayer';
import { createNewGame } from '../../logic/state';
import {
  CONIFERS,
  POND,
  pondWillows,
  sceneryArt,
  TREE_SCALE,
  TREE_SPECIES,
  TREE_TINT,
  treeArt,
  treeLook,
  treeSpecies,
  woodMix,
  type TreeLook,
  type TreeSite,
  type TreeSpecies,
} from '../../scenes/art';
import { speciesAt, treeSite } from './species';

const maps = (n: number): MapLayer[] => Array.from({ length: n }, (_, i) => newMapLayer(createNewGame(), 1000 + i * 7919));

const site = (over: Partial<TreeSite>): TreeSite => ({ x: 0, y: 0, mix: 'mixed', edge: false, start: false, pond: false, ...over });

/** Every tile of a w × h block, as sites with `over`. */
const sites = (over: Partial<TreeSite>, w = 60, h = 40) => Array.from({ length: w * h }, (_, i) => site({ x: i % w, y: Math.floor(i / w), ...over }));

/**
 * Spelled out here rather than taken from the code under test: is a pond drawn (by FarmScene, on the new farm)
 * within reach of (x, y)? A pond site shows only in the map, 4+ tiles clear of the starting land,
 * not under a tree or on a deposit.
 */
function drawnPondNear(layer: MapLayer, x: number, y: number): boolean {
  const S = START_LAND;
  const shows = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= MAP_WIDTH || py >= MAP_HEIGHT || sceneryArt(px, py) !== POND) return false;
    if (px >= S.x - 4 && px < S.x + S.w + 4 && py >= S.y - 4 && py < S.y + S.h + 4) return false;
    return !treeAt(layer, px, py) && !depositAt(layer, px, py);
  };
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (shows(x + dx, y + dy)) return true;
  return false;
}

const share = (list: TreeSpecies[], kind: TreeSpecies) => list.filter((s) => s === kind).length / list.length;

describe('tree species', () => {
  it('follows the wood mix away from edges and ponds: conifer woods are pine and spruce, broadleaf oak and beech', () => {
    const conifer = sites({ mix: 'conifer' }).map(treeSpecies);
    expect(new Set(conifer)).toEqual(new Set(['pine', 'spruce']));
    const broadleaf = sites({ mix: 'broadleaf' }).map(treeSpecies);
    expect(new Set(broadleaf)).toEqual(new Set(['oak', 'beech']));
    const mixed = sites({ mix: 'mixed' }).map(treeSpecies);
    expect(new Set(mixed)).toEqual(new Set(['oak', 'pine', 'beech', 'spruce', 'birch']));
  });

  it('grows willows only near a pond, and often there', () => {
    for (const mix of ['conifer', 'broadleaf', 'mixed'] as const) {
      for (const edge of [false, true]) expect(sites({ mix, edge, start: true }).map(treeSpecies)).not.toContain('willow');
    }
    const byPond = sites({ pond: true }).map(treeSpecies);
    expect(share(byPond, 'willow')).toBeGreaterThan(0.4);
    expect(share(byPond, 'willow')).toBeLessThan(0.7);
  });

  it('favours birches at the forest edge and keeps apples rare: the start grove and edges only', () => {
    for (const mix of ['conifer', 'broadleaf', 'mixed'] as const) {
      const inner = sites({ mix }).map(treeSpecies);
      const edge = sites({ mix, edge: true }).map(treeSpecies);
      expect(share(edge, 'birch')).toBeGreaterThan(share(inner, 'birch') + 0.2);
      expect(inner).not.toContain('apple');
      expect(share(edge, 'apple')).toBeGreaterThan(0);
      expect(share(edge, 'apple')).toBeLessThan(0.1);
    }
    const start = sites({ start: true }).map(treeSpecies);
    expect(share(start, 'apple')).toBeGreaterThan(0.05);
    expect(share(start, 'apple')).toBeLessThan(0.2);
  });

  it('gives each layout block one wood mix, and the blocks a spread of them', () => {
    const mixes = new Set(MAP_BLOCKS.map((p) => woodMix(p, p.x, p.y)));
    expect(mixes).toEqual(new Set(['conifer', 'broadleaf', 'mixed']));
    for (const p of MAP_BLOCKS) expect(woodMix(p, p.x + p.w - 1, p.y + p.h - 1)).toBe(woodMix(p, p.x, p.y));
  });

  it('on generated maps, forests read as conifer, broadleaf or mixed woods, willows stand by ponds and birches at edges', () => {
    let edgeBirch = 0;
    let edges = 0;
    let innerBirch = 0;
    let inner = 0;
    const counts = Object.fromEntries(TREE_SPECIES.map((s) => [s, 0])) as Record<TreeSpecies, number>;
    for (const layer of maps(40)) {
      for (const t of layer.trees) {
        const kind = speciesAt(layer, t.x, t.y);
        const where = treeSite(layer, t.x, t.y);
        counts[kind]++;
        if (kind === 'willow') expect(drawnPondNear(layer, t.x, t.y), `willow at ${t.x},${t.y}`).toBe(true);
        if (kind === 'apple') expect(where.start || where.edge).toBe(true);
        // The wood's main mix holds, apart from the edge's birches and apples and the ponds' willows.
        const mix = woodMix(blockAt(t.x, t.y), t.x, t.y);
        if (!where.edge && !where.pond) {
          if (mix === 'conifer') expect(CONIFERS).toContain(kind);
          if (mix === 'broadleaf') expect(['oak', 'beech']).toContain(kind);
        }
        if (where.edge) {
          edges++;
          if (kind === 'birch') edgeBirch++;
        } else {
          inner++;
          if (kind === 'birch') innerBirch++;
        }
      }
    }
    expect(edgeBirch / edges).toBeGreaterThan((innerBirch / inner) * 2);
    // Every species but the willow grows on the map's forests; apples stay rare.
    for (const s of TREE_SPECIES) if (s !== 'willow') expect(counts[s], s).toBeGreaterThan(0);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(counts.apple / total).toBeLessThan(0.08);
  });

  it('is fixed by position, so the same map always shows the same species', () => {
    const [a] = maps(1);
    const b = newMapLayer(createNewGame(), 1000);
    expect(b.trees.map((t) => speciesAt(b, t.x, t.y))).toEqual(a.trees.map((t) => speciesAt(a, t.x, t.y)));
  });

  it('puts one or two decorative willows beside a pond, on its neighbouring tiles', () => {
    let ponds = 0;
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (sceneryArt(x, y) !== POND) continue;
        ponds++;
        const { count, spots } = pondWillows(x, y);
        expect([1, 2]).toContain(count);
        expect(spots).toHaveLength(8);
        for (const s of spots) expect(Math.max(Math.abs(s.x - x), Math.abs(s.y - y))).toBe(1);
        expect(pondWillows(x, y)).toEqual({ count, spots });
      }
    }
    expect(ponds).toBeGreaterThan(0);
  });
});

describe('tree art and look', () => {
  it('draws stumps, a broadleaf or conifer sapling, and the species sprite for young and grown trees', () => {
    expect(treeArt('oak', 'stump')).toBe('tree_stump');
    expect(treeArt('spruce', 'sapling')).toBe('tree_sapling_conifer');
    expect(treeArt('pine', 'sapling')).toBe('tree_sapling_conifer');
    expect(treeArt('willow', 'sapling')).toBe('tree_sapling_broadleaf');
    expect(treeArt('birch', 'young')).toBe('tree_birch');
    expect(treeArt('beech', 'grown')).toBe('tree_beech');
  });

  it('varies size, facing and tint per tile, deterministically and within bounds', () => {
    const looks: ({ x: number; y: number } & TreeLook)[] = [];
    for (let y = START_LAND.y - 20; y < START_LAND.y + 20; y++) for (let x = 0; x < MAP_WIDTH; x++) looks.push({ x, y, ...treeLook(x, y) });
    for (const l of looks) {
      expect(treeLook(l.x, l.y)).toEqual({ flip: l.flip, scale: l.scale, tint: l.tint });
      expect(l.scale).toBeGreaterThanOrEqual(TREE_SCALE[0]);
      expect(l.scale).toBeLessThanOrEqual(TREE_SCALE[1]);
      const [r, g, b] = [(l.tint >> 16) & 255, (l.tint >> 8) & 255, l.tint & 255];
      expect(g).toBe(255);
      // At most 6% off white, and only one of red (blue-green) or blue (yellow-green).
      expect(Math.min(r, b)).toBeGreaterThanOrEqual(Math.floor(255 * (1 - TREE_TINT)));
      expect(Math.max(r, b)).toBe(255);
    }
    const flipped = looks.filter((l) => l.flip).length / looks.length;
    expect(flipped).toBeGreaterThan(0.4);
    expect(flipped).toBeLessThan(0.6);
    const scales = looks.map((l) => l.scale);
    expect(Math.min(...scales)).toBeLessThan(0.88);
    expect(Math.max(...scales)).toBeGreaterThan(1.12);
    expect(looks.some((l) => (l.tint & 255) < 255)).toBe(true);
    expect(looks.some((l) => l.tint >> 16 < 255)).toBe(true);
    // Neighbouring trees differ.
    const sameAsRight = looks.filter((l, i) => looks[i + 1]?.y === l.y && Math.abs(looks[i + 1].scale - l.scale) < 0.01 && looks[i + 1].flip === l.flip);
    expect(sameAsRight.length / looks.length).toBeLessThan(0.05);
  });
});
