import { describe, expect, it } from 'vitest';
import { SEASONS } from '../data/seasons';
import { MAP_HEIGHT, MAP_WIDTH } from '../logic/constants';
import { DECOR_ART, FERN_ART, LOG_ART, SCENERY, SEASON_DECOR, STONE_ART, TUFT_ART } from './art';
import {
  cellKind,
  DECOR_CAP,
  DECOR_CELL,
  DECOR_JITTER,
  decorArt,
  forestDistance,
  scatterDecor,
  type DecorGround,
} from './decor';

/** An open meadow of w × h tiles, with trees on the tiles listed (as "x,y") and nothing blocked. */
function ground(w: number, h: number, trees: Iterable<string> = [], blocked: Iterable<string> = []): DecorGround {
  const t = new Set(trees);
  const b = new Set(blocked);
  return { width: w, height: h, tree: (x, y) => t.has(`${x},${y}`), blocked: (x, y) => b.has(`${x},${y}`) };
}

/** A square forest of side `n` with its top corner at (x0, y0). */
function forest(x0: number, y0: number, n: number): string[] {
  const out: string[] = [];
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) out.push(`${x},${y}`);
  return out;
}

describe('ground decorations', () => {
  it('scatters the same spots every time, back to front, from a fixed seed', () => {
    const g = ground(MAP_WIDTH, MAP_HEIGHT, forest(20, 20, 6));
    const a = scatterDecor(g);
    expect(scatterDecor(g)).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
    for (let i = 1; i < a.length; i++) expect(a[i].x + a[i].y).toBeGreaterThanOrEqual(a[i - 1].x + a[i - 1].y);
    // Another seed is another scatter.
    expect(scatterDecor(g, 1)).not.toEqual(a);
    // A decoration lies near its tile's centre, never on a neighbour's.
    for (const s of a) {
      expect(Math.abs(s.dx)).toBeLessThanOrEqual(DECOR_JITTER);
      expect(Math.abs(s.dy)).toBeLessThanOrEqual(DECOR_JITTER);
    }
  });

  it('decorates about one meadow tile in four, clustered by coarse cells', () => {
    const g = ground(MAP_WIDTH, MAP_HEIGHT);
    const spots = scatterDecor(g);
    const share = spots.length / (MAP_WIDTH * MAP_HEIGHT);
    expect(share).toBeGreaterThan(0.18);
    expect(share).toBeLessThan(0.33);
    expect(spots.every((s) => s.role !== 'undergrowth')).toBe(true);
    // Flowery cells are much busier than plain ones: clusters, not an even sprinkle.
    const perKind = { flowery: [0, 0], stony: [0, 0], plain: [0, 0] };
    for (let y = 0; y < MAP_HEIGHT; y++) for (let x = 0; x < MAP_WIDTH; x++) perKind[cellKind(Math.floor(x / DECOR_CELL), Math.floor(y / DECOR_CELL))][1]++;
    for (const s of spots) perKind[cellKind(Math.floor(s.x / DECOR_CELL), Math.floor(s.y / DECOR_CELL))][0]++;
    const density = (k: keyof typeof perKind) => perKind[k][0] / perKind[k][1];
    expect(density('flowery')).toBeGreaterThan(3 * density('plain'));
    // Flowery cells show the season's features, stony ones stones.
    const roles = (kind: keyof typeof perKind) => spots.filter((s) => cellKind(Math.floor(s.x / DECOR_CELL), Math.floor(s.y / DECOR_CELL)) === kind);
    expect(roles('flowery').filter((s) => s.role === 'feature').length).toBeGreaterThan(roles('flowery').length / 2);
    expect(roles('stony').filter((s) => s.role === 'stone').length).toBeGreaterThan(roles('stony').length / 3);
  });

  it('never goes past the cap, keeping the undergrowth and thinning the meadow', () => {
    // A huge map full of small groves: far more candidates than the cap.
    const trees: string[] = [];
    for (let y = 2; y < 200; y += 9) for (let x = 2; x < 200; x += 9) trees.push(...forest(x, y, 2));
    const spots = scatterDecor(ground(200, 200, trees));
    expect(spots.length).toBe(DECOR_CAP);
    const edge = scatterDecor(ground(200, 200, trees)).filter((s) => s.role === 'undergrowth');
    expect(edge.length).toBeGreaterThan(0);
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(spots.length); // one per tile
    // The real map stays under it.
    expect(scatterDecor(ground(MAP_WIDTH, MAP_HEIGHT, forest(10, 10, 8))).length).toBeLessThan(DECOR_CAP);
  });

  it('puts undergrowth 1–2 tiles outside a forest: not on a tree, not deep inside, not in the open meadow', () => {
    const trees = forest(20, 20, 8);
    const g = ground(MAP_WIDTH, MAP_HEIGHT, trees);
    const spots = scatterDecor(g);
    const treeSet = new Set(trees);
    expect(spots.some((s) => treeSet.has(`${s.x},${s.y}`))).toBe(false);
    const edge = spots.filter((s) => s.role === 'undergrowth');
    expect(edge.length).toBeGreaterThan(10);
    for (const s of edge) {
      const d = forestDistance(g, s.x, s.y);
      expect(d === 1 || d === 2, `${s.x},${s.y}`).toBe(true);
    }
    // Every spot near the forest is undergrowth; none of the meadow's lies within 2 tiles of it.
    for (const s of spots) {
      const near = s.x >= 18 && s.x <= 29 && s.y >= 18 && s.y <= 29;
      expect(s.role === 'undergrowth', `${s.x},${s.y}`).toBe(near);
    }
    // Denser right at the edge than in the open.
    let edgeTiles = 0;
    for (let y = 0; y < MAP_HEIGHT; y++) for (let x = 0; x < MAP_WIDTH; x++) if (forestDistance(g, x, y)) edgeTiles++;
    const open = MAP_WIDTH * MAP_HEIGHT - edgeTiles - trees.length;
    expect(edge.length / edgeTiles).toBeGreaterThan((spots.length - edge.length) / open);
  });

  it('a gap inside a forest is the forest, not its edge', () => {
    const trees = forest(10, 10, 5).filter((t) => t !== '12,12');
    const g = ground(30, 30, trees);
    expect(forestDistance(g, 12, 12)).toBe(0);
    expect(forestDistance(g, 9, 12)).toBe(1);
    expect(forestDistance(g, 8, 12)).toBe(2);
    expect(forestDistance(g, 7, 12)).toBeNull();
    expect(forestDistance(g, 11, 11)).toBe(0); // a tree
    expect(scatterDecor(g).some((s) => s.x === 12 && s.y === 12)).toBe(false);
  });

  it('skips blocked tiles (deposits, scenery)', () => {
    const blocked: string[] = [];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) blocked.push(`${x},${y}`);
    const spots = scatterDecor(ground(40, 40, [], blocked));
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.some((s) => s.x < 20 && s.y < 20)).toBe(false);
  });

  it('changes art with the season: each season its own set, tufts and stones all year, undergrowth in every season', () => {
    const spots = scatterDecor(ground(MAP_WIDTH, MAP_HEIGHT, forest(20, 20, 8)));
    for (const season of SEASONS) {
      const arts = new Set(spots.map((s) => decorArt(s, season)));
      for (const a of SEASON_DECOR[season]) expect(arts, `${season}: ${a}`).toContain(a);
      for (const other of SEASONS) if (other !== season) for (const a of SEASON_DECOR[other]) expect(arts.has(a), `${season} has ${a}`).toBe(false);
      for (const a of [...TUFT_ART, ...STONE_ART, ...FERN_ART, LOG_ART, ...SCENERY]) expect(arts, `${season}: ${a}`).toContain(a);
      for (const a of arts) expect(DECOR_ART).toContain(a);
    }
    // Same spots, other art: a spring flower is a winter twig.
    const feature = spots.find((s) => s.role === 'feature')!;
    expect(SEASON_DECOR.spring).toContain(decorArt(feature, 'spring'));
    expect(SEASON_DECOR.winter).toContain(decorArt(feature, 'winter'));
  });
});
