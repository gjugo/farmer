/**
 * Deterministic value noise over the map's tile coordinates: smooth, low-frequency patches for scattering art
 * (ground colour, meadow flowers) without a save. Plain TypeScript, no Phaser.
 */

/** A small deterministic hash of a tile, for scattering art without a save. */
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Wavelength of the first octave, in tiles; the second octave is half as long and half as strong. */
export const NOISE_WAVELENGTH = 8;

/** The lattice value at integer point (ix, iy): -1..1. */
function lattice(ix: number, iy: number, seed: number): number {
  return (hash(ix, iy, seed) / 0xffffffff) * 2 - 1;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** One octave of value noise at (x, y) with the given wavelength: -1..1. */
function octave(x: number, y: number, wavelength: number, seed: number): number {
  const fx = x / wavelength;
  const fy = y / wavelength;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const top = lattice(ix, iy, seed) * (1 - tx) + lattice(ix + 1, iy, seed) * tx;
  const bottom = lattice(ix, iy + 1, seed) * (1 - tx) + lattice(ix + 1, iy + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Two octaves of value noise at tile (x, y), always in -1..1. Each `seed` gives an independent field; the same
 * tile and seed always give the same value.
 */
export function noise(x: number, y: number, seed = 0): number {
  const n = octave(x, y, NOISE_WAVELENGTH, seed * 2 + 1) + 0.5 * octave(x + 101, y + 57, NOISE_WAVELENGTH / 2, seed * 2 + 2);
  return Math.max(-1, Math.min(1, n / 1.5));
}
