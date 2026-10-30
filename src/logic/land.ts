import type { LandState } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function createLand(width: number, height: number, ownedArea?: Rect): LandState {
  const land: LandState = { width, height, owned: new Array<number>(width * height).fill(0) };
  if (ownedArea) setOwnedRect(land, ownedArea, true);
  return land;
}

export function inBounds(land: LandState, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < land.width && y < land.height;
}

export function isOwned(land: LandState, x: number, y: number): boolean {
  return inBounds(land, x, y) && land.owned[y * land.width + x] === 1;
}

export function setOwned(land: LandState, x: number, y: number, owned: boolean): void {
  if (!inBounds(land, x, y)) return;
  land.owned[y * land.width + x] = owned ? 1 : 0;
}

export function setOwnedRect(land: LandState, rect: Rect, owned: boolean): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) setOwned(land, x, y, owned);
  }
}

export function ownedCount(land: LandState): number {
  return land.owned.reduce((n, v) => n + v, 0);
}
