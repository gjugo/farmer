import type { LandState } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function createLand(width: number, height: number): LandState {
  return { width, height };
}

export function inBounds(land: LandState, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < land.width && y < land.height;
}

/** Is (x, y) inside `r`? */
export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}
