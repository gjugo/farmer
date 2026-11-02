import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEASONS, type Season } from '../data/seasons';
import { SOIL_QUALITY } from '../data/soil';
import { ART_RES, usedArt, type PackManifest } from './art';
import {
  FOREST_FLOOR,
  GROUND_FRAMES,
  groundFrames,
  groundLook,
  groundTint,
  groundVariant,
  groundZone,
  LOCKED_TINT,
  MEADOW_SPECIALS,
  noiseTint,
  PLAIN_GRASS,
  rgbOf,
  soilTint,
  WET_MEADOW,
  WINTER_SPECIALS,
  ZONE_TINT,
  zoneShade,
  type GroundZone,
  type Rgb,
} from './ground';

const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../public/assets/farm/manifest.json'), 'utf8')) as PackManifest;
const assets = new Map(manifest.assets.map((a) => [a.name, a]));

const W = 160;
const H = 160;
const area = Array.from({ length: W * H }, (_, i) => [i % W, Math.floor(i / W)] as const);
const plain = new Set<string>(PLAIN_GRASS);
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lum = ([r, g, b]: Rgb) => 0.3 * r + 0.59 * g + 0.11 * b;

describe('ground tiles in the pack', () => {
  it('has every ground frame, the size and anchor of plain grass, and the game loads them', () => {
    const grass = assets.get('grass_0_summer')!.res[ART_RES];
    const used = new Set(usedArt());
    for (const frame of GROUND_FRAMES) {
      const art = assets.get(frame);
      expect(art, frame).toBeDefined();
      expect(art!.res[ART_RES].anchor, frame).toEqual(grass.anchor);
      expect([art!.res[ART_RES].w, art!.res[ART_RES].h], frame).toEqual([grass.w, grass.h]);
      expect(used.has(frame), frame).toBe(true);
    }
  });

  it('keeps each season’s atlas column within 4096 px', () => {
    for (const season of SEASONS) expect(groundFrames(season).length * (128 + 2)).toBeLessThanOrEqual(4096);
  });
});

describe('meadow variants', () => {
  const shares = (season: Season) => {
    const counts = new Map<string, number>();
    for (const [x, y] of area) {
      const v = groundVariant(x, y, 'meadow', season);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return (name: string) => (counts.get(name) ?? 0) / area.length;
  };

  it('is mostly plain grass, with each special tile close to its weight', () => {
    for (const season of ['summer', 'winter'] as const) {
      const share = shares(season);
      const plainShare = PLAIN_GRASS.reduce((n, g) => n + share(g), 0);
      expect(plainShare, season).toBeGreaterThan(0.56);
      expect(plainShare, season).toBeLessThan(0.64);
      for (const g of PLAIN_GRASS) expect(share(g)).toBeCloseTo(plainShare / 3, 1);
      for (const s of season === 'winter' ? WINTER_SPECIALS : MEADOW_SPECIALS) {
        expect(Math.abs(share(s.name) - s.weight / 100), `${season} ${s.name}`).toBeLessThan(0.035);
      }
    }
  });

  it('draws summer specials from spring to autumn and the winter ones in winter only', () => {
    for (const season of SEASONS) {
      const names = new Set(area.slice(0, 4000).map(([x, y]) => groundVariant(x, y, 'meadow', season)));
      for (const s of MEADOW_SPECIALS) expect(names.has(s.name), `${season} ${s.name}`).toBe(season !== 'winter');
      for (const s of WINTER_SPECIALS) expect(names.has(s.name), `${season} ${s.name}`).toBe(season === 'winter');
    }
  });

  it('gathers special tiles into patches of one kind', () => {
    const at = (x: number, y: number) => groundVariant(x, y, 'meadow', 'summer');
    let special = 0;
    let specialNext = 0;
    let sameKind = 0;
    for (const [x, y] of area) {
      if (plain.has(at(x, y)) || x + 1 >= W) continue;
      special++;
      const next = at(x + 1, y);
      if (!plain.has(next)) specialNext++;
      if (next === at(x, y)) sameKind++;
    }
    // Scattered at random, a neighbour would be special 40% of the time, and the same kind 1 time in 6 of those.
    expect(specialNext / special).toBeGreaterThan(0.55);
    expect(sameKind / specialNext).toBeGreaterThan(0.5);
  });

  it('has no diagonal stripes: plain grass along a diagonal is as mixed as at random', () => {
    const at = (x: number, y: number) => groundVariant(x, y, 'meadow', 'summer');
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [1, 0],
      [0, 1],
    ]) {
      let pairs = 0;
      let same = 0;
      for (const [x, y] of area) {
        const a = at(x, y);
        const b = at(x + dx, y + dy);
        if (!plain.has(a) || !plain.has(b)) continue;
        pairs++;
        if (a === b) same++;
      }
      expect(Math.abs(same / pairs - 1 / 3), `${dx},${dy}`).toBeLessThan(0.04);
    }
  });

  it('always gives the same tile the same variant', () => {
    for (const [x, y] of area.slice(0, 500)) expect(groundVariant(x, y, 'meadow', 'spring')).toBe(groundVariant(x, y, 'meadow', 'spring'));
  });
});

describe('ground zones', () => {
  const trees = new Set(['10,10']);
  const ponds = new Set(['30,30']);
  const zone = (x: number, y: number, t = trees, p = ponds) =>
    groundZone(x, y, (a, b) => t.has(`${a},${b}`), (a, b) => p.has(`${a},${b}`));

  it('is forest floor under a tree and within 1 tile of it', () => {
    expect(zone(10, 10)).toBe('forest');
    for (const [x, y] of [[9, 9], [11, 11], [9, 11], [11, 10], [10, 9]]) expect(zone(x, y), `${x},${y}`).toBe('forest');
    for (const [x, y] of [[8, 10], [12, 10], [10, 12], [12, 12]]) expect(zone(x, y), `${x},${y}`).toBe('meadow');
  });

  it('is wet meadow within 2 tiles of a pond site', () => {
    for (const [x, y] of [[30, 30], [28, 28], [32, 32], [32, 30], [30, 28]]) expect(zone(x, y), `${x},${y}`).toBe('wet');
    for (const [x, y] of [[27, 30], [33, 30], [30, 33], [33, 33]]) expect(zone(x, y), `${x},${y}`).toBe('meadow');
  });

  it('puts forest before wet where both reach', () => {
    expect(zone(5, 5, new Set(['5,6']), new Set(['5,4']))).toBe('forest');
  });

  it('draws the zone’s own tiles', () => {
    for (const season of SEASONS) {
      expect(FOREST_FLOOR as readonly string[]).toContain(groundVariant(3, 4, 'forest', season));
      expect(WET_MEADOW as readonly string[]).toContain(groundVariant(3, 4, 'wet', season));
      expect(groundLook(3, 4, SOIL_QUALITY.normal, 'forest', false, season).art).toMatch(new RegExp(`^forest_\\d_${season}$`));
    }
  });

  it('fades the zone shade over the edge tiles instead of stopping at a tile edge', () => {
    // Forest on x < 10, meadow from x = 10.
    const zoneAt = (x: number): GroundZone => (x < 10 ? 'forest' : 'meadow');
    const shade = (x: number) => lum(zoneShade(x, 5, (zx) => zoneAt(zx), 'summer'));
    const forest = lum(rgbOf(ZONE_TINT.forest.summer));
    const meadow = lum(rgbOf(ZONE_TINT.meadow.summer));
    expect(shade(5)).toBeCloseTo(forest, 6);
    expect(shade(15)).toBeCloseTo(meadow, 6);
    expect(shade(9)).toBeGreaterThan(forest);
    expect(shade(10)).toBeGreaterThan(shade(9));
    expect(shade(10)).toBeLessThan(meadow);
  });

  it('shades the forest floor darker than the meadow next to it', () => {
    for (const season of SEASONS) {
      const meadow = rgbOf(groundTint(4, 4, SOIL_QUALITY.normal, 'meadow', false, season));
      const forest = rgbOf(groundTint(4, 4, SOIL_QUALITY.normal, 'forest', false, season));
      expect(lum(forest)).toBeLessThan(lum(meadow));
    }
  });
});

describe('ground tint', () => {
  const noiseTints = (season: Season) => area.map(([x, y]) => noiseTint(x, y, season));

  it('makes gentle colour patches: at most about ±7% around their middle', () => {
    for (const season of SEASONS) {
      const tints = noiseTints(season);
      for (let c = 0; c < 3; c++) {
        const values = tints.map((t) => t[c]);
        const mid = (Math.max(...values) + Math.min(...values)) / 2;
        for (const v of values) expect(Math.abs(v - mid)).toBeLessThanOrEqual(0.07);
        for (const v of values) expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps patches fainter in autumn and nearly gone on winter snow, with no green on the snow', () => {
    const spread = (season: Season) => {
      const l = noiseTints(season).map(lum);
      return Math.max(...l) - Math.min(...l);
    };
    expect(spread('autumn')).toBeLessThan(spread('summer'));
    expect(spread('winter')).toBeLessThan(spread('autumn') / 2);
    for (const [r, g, b] of noiseTints('winter')) {
      expect(g).toBe(r);
      expect(b).toBe(r);
    }
  });

  it('shows the soil through the patches: rich lusher, poor drier and yellower, normal neutral', () => {
    for (const season of SEASONS) {
      expect(soilTint(SOIL_QUALITY.normal, season)).toBe(0xffffff);
      const [pr, pg, pb] = rgbOf(soilTint(SOIL_QUALITY.poor, season));
      expect(pb).toBeLessThan(pg); // yellower: blue taken down most
      expect(pg).toBeLessThanOrEqual(pr);
    }
    for (const season of ['spring', 'summer', 'autumn'] as const) {
      const [r, g, b] = rgbOf(soilTint(SOIL_QUALITY.rich, season));
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
    }
    // On snow, green would read as mint: winter's rich soil is a faint cool shade instead.
    const [r, g, b] = rgbOf(soilTint(SOIL_QUALITY.rich, 'winter'));
    expect(b).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThanOrEqual(r);
  });

  it('keeps the soil difference stronger than the noise', () => {
    for (const season of SEASONS) {
      const tints = noiseTints(season);
      // The widest the patches ever pull two tiles apart.
      const ext = [0, 1, 2].map((c) => [Math.min(...tints.map((t) => t[c])), Math.max(...tints.map((t) => t[c]))]);
      const noiseSpan = Math.hypot(...ext.map(([lo, hi]) => hi - lo));
      for (const quality of [SOIL_QUALITY.rich, SOIL_QUALITY.poor]) {
        for (const [x, y] of area.slice(0, 2000)) {
          const normal = rgbOf(groundTint(x, y, SOIL_QUALITY.normal, 'meadow', false, season));
          const other = rgbOf(groundTint(x, y, quality, 'meadow', false, season));
          expect(dist(normal, other), `${season} ${quality}`).toBeGreaterThan(noiseSpan);
        }
      }
    }
  });

  it('draws locked land darker and muted, over any variant', () => {
    for (const season of SEASONS) {
      for (const zone of ['meadow', 'forest', 'wet'] as const) {
        const open = rgbOf(groundTint(7, 9, SOIL_QUALITY.normal, zone, false, season));
        const locked = rgbOf(groundTint(7, 9, SOIL_QUALITY.normal, zone, true, season));
        for (let c = 0; c < 3; c++) expect(locked[c]).toBeLessThan(open[c]);
        expect(lum(locked) / lum(open), `${season} ${zone}`).toBeLessThan(season === 'winter' ? 0.92 : 0.8);
      }
      // Muted: green, the grass's strongest colour, is taken down the most while it grows.
      const [r, g, b] = rgbOf(LOCKED_TINT[season]);
      if (season !== 'winter') {
        expect(g).toBeLessThan(r);
        expect(g).toBeLessThan(b);
      }
    }
    // The tint is the same multiply on every variant, so the locked look follows the tile.
    expect(groundLook(2, 3, SOIL_QUALITY.normal, 'meadow', true, 'summer').art).toBe(groundLook(2, 3, SOIL_QUALITY.normal, 'meadow', false, 'summer').art);
  });
});
