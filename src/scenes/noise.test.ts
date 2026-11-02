import { describe, expect, it } from 'vitest';
import { hash, noise, NOISE_WAVELENGTH } from './noise';

const tiles = (w: number, h: number) => Array.from({ length: w * h }, (_, i) => [i % w, Math.floor(i / w)] as const);

describe('noise', () => {
  it('is deterministic: the same tile and seed always give the same value', () => {
    for (const [x, y] of tiles(30, 30)) {
      expect(noise(x, y)).toBe(noise(x, y));
      expect(noise(x, y, 3)).toBe(noise(x, y, 3));
    }
    expect(hash(5, 7, 2)).toBe(hash(5, 7, 2));
  });

  it('stays within -1..1 and uses most of that range', () => {
    let min = 1;
    let max = -1;
    for (const [x, y] of tiles(200, 200)) {
      const n = noise(x - 100, y - 100, 1);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
    expect(min).toBeLessThan(-0.5);
    expect(max).toBeGreaterThan(0.5);
  });

  it('is low-frequency: neighbours are close, tiles a wavelength apart are not', () => {
    let near = 0;
    let far = 0;
    const all = tiles(100, 100);
    for (const [x, y] of all) {
      near += Math.abs(noise(x, y) - noise(x + 1, y));
      far += Math.abs(noise(x, y) - noise(x + NOISE_WAVELENGTH, y + NOISE_WAVELENGTH));
    }
    expect(near / all.length).toBeLessThan(0.15);
    expect(far / all.length).toBeGreaterThan(3 * (near / all.length));
  });

  it('gives each seed its own field', () => {
    let same = 0;
    for (const [x, y] of tiles(50, 50)) if (Math.abs(noise(x, y, 1) - noise(x, y, 2)) < 0.05) same++;
    expect(same).toBeLessThan(2500 * 0.2);
  });
});
