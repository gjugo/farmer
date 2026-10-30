import { describe, expect, it } from 'vitest';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { Game } from './game';
import { createLand, isOwned, ownedCount } from './land';
import {
  buyParcel,
  checkBuy,
  createParcels,
  FARM_PARCELS,
  isNextToOwned,
  parcelAt,
  parcelPrice,
  parcelsBought,
  parcelsForSale,
  PARCEL_MAX_SIZE,
  type Parcel,
} from './parcels';
import { deserialize, serialize } from './save';

const byId = (id: string): Parcel => FARM_PARCELS.find((p) => p.id === id)!;
/** The parcel directly right of the starting land. */
const rightOfStart = () => parcelAt(FARM_PARCELS, START_LAND.x + START_LAND.w, START_LAND.y)!;

describe('parcel grid', () => {
  it('covers every map tile exactly once', () => {
    const seen = new Array<number>(MAP_WIDTH * MAP_HEIGHT).fill(0);
    for (const p of FARM_PARCELS) {
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) seen[y * MAP_WIDTH + x]++;
    }
    expect(seen.every((n) => n === 1)).toBe(true);
  });

  it('makes the starting land one parcel and keeps the others small', () => {
    expect(FARM_PARCELS.filter((p) => p.x === START_LAND.x && p.y === START_LAND.y && p.w === START_LAND.w && p.h === START_LAND.h)).toHaveLength(1);
    for (const p of FARM_PARCELS) {
      if (p.x === START_LAND.x && p.w === START_LAND.w) continue;
      expect(p.w).toBeLessThanOrEqual(PARCEL_MAX_SIZE);
      expect(p.w).toBeGreaterThanOrEqual(PARCEL_MAX_SIZE / 2);
    }
    for (const p of FARM_PARCELS) if (!(p.y === START_LAND.y)) expect(p.h).toBeLessThanOrEqual(PARCEL_MAX_SIZE);
    expect(new Set(FARM_PARCELS.map((p) => p.id)).size).toBe(FARM_PARCELS.length);
  });

  it('chunks long strips into near-equal blocks', () => {
    const parcels = createParcels(20, 4, { x: 0, y: 0, w: 2, h: 4 }, 6);
    expect(parcels.map((p) => [p.x, p.w])).toEqual([
      [0, 2],
      [2, 6],
      [8, 6],
      [14, 6],
    ]);
  });
});

describe('parcel adjacency', () => {
  it('offers only the parcels touching the starting land', () => {
    const land = createLand(MAP_WIDTH, MAP_HEIGHT, START_LAND);
    const forSale = parcelsForSale(land, FARM_PARCELS);
    // Above, below, left and right of the start; diagonal corners do not count.
    expect(forSale).toHaveLength(4);
    for (const p of forSale) expect(isNextToOwned(land, p)).toBe(true);
    const corner = parcelAt(FARM_PARCELS, START_LAND.x - 1, START_LAND.y - 1)!;
    expect(isNextToOwned(land, corner)).toBe(false);
  });

  it('offers nothing when no land is owned', () => {
    const land = createLand(MAP_WIDTH, MAP_HEIGHT);
    expect(parcelsForSale(land, FARM_PARCELS)).toEqual([]);
  });
});

describe('parcel prices', () => {
  it('starts at $500 and grows 1.5× rounded to $10', () => {
    expect([0, 1, 2, 3, 4, 5].map(parcelPrice)).toEqual([500, 750, 1130, 1700, 2550, 3830]);
    for (let n = 0; n < 12; n++) expect(parcelPrice(n) % 10).toBe(0);
  });
});

describe('buying parcels', () => {
  it('buys a parcel for $500, makes it owned and the next one costs $750', () => {
    const game = new Game();
    const parcel = rightOfStart();
    const before = ownedCount(game.state.land);
    const result = buyParcel(game, FARM_PARCELS, START_LAND, parcel);
    expect(result).toEqual({ ok: true, price: 500 });
    expect(game.money).toBe(0);
    expect(ownedCount(game.state.land)).toBe(before + parcel.w * parcel.h);
    expect(isOwned(game.state.land, parcel.x, parcel.y)).toBe(true);
    expect(parcelsBought(game.state.land, FARM_PARCELS, START_LAND)).toBe(1);

    // A Path can be placed on the new land at once.
    game.earn(100);
    expect(game.place('path', parcel.x + 1, parcel.y + 1).ok).toBe(true);

    game.earn(1000);
    const next = parcelsForSale(game.state.land, FARM_PARCELS)[0];
    expect(checkBuy(game.state.land, FARM_PARCELS, START_LAND, next, game.money)).toEqual({ ok: true, price: 750 });
  });

  it('puts new neighbours up for sale', () => {
    const game = new Game();
    const parcel = rightOfStart();
    const beforeIds = parcelsForSale(game.state.land, FARM_PARCELS).map((p) => p.id);
    buyParcel(game, FARM_PARCELS, START_LAND, parcel);
    const after = parcelsForSale(game.state.land, FARM_PARCELS).map((p) => p.id);
    expect(after).not.toContain(parcel.id);
    expect(after.length).toBeGreaterThan(beforeIds.length - 1);
    expect(after.some((id) => !beforeIds.includes(id))).toBe(true);
  });

  it('refuses a parcel the player cannot afford', () => {
    const game = new Game();
    game.spend(1);
    const before = JSON.stringify(game.state.land);
    expect(buyParcel(game, FARM_PARCELS, START_LAND, rightOfStart())).toEqual({ ok: false, reason: 'money', price: 500 });
    expect(game.money).toBe(499);
    expect(JSON.stringify(game.state.land)).toBe(before);
  });

  it('refuses a parcel that is not next to owned land', () => {
    const game = new Game();
    game.earn(10_000);
    const far = byId('p0-0');
    expect(buyParcel(game, FARM_PARCELS, START_LAND, far)).toMatchObject({ ok: false, reason: 'not-adjacent' });
    expect(game.money).toBe(10_500);
    expect(isOwned(game.state.land, far.x, far.y)).toBe(false);
  });

  it('refuses a parcel that is already owned', () => {
    const game = new Game();
    game.earn(10_000);
    const start = parcelAt(FARM_PARCELS, START_LAND.x, START_LAND.y)!;
    expect(buyParcel(game, FARM_PARCELS, START_LAND, start)).toMatchObject({ ok: false, reason: 'owned' });
    expect(game.money).toBe(10_500);
  });

  it('keeps bought land after a save and load', () => {
    const game = new Game();
    const parcel = rightOfStart();
    buyParcel(game, FARM_PARCELS, START_LAND, parcel);
    const loaded = deserialize(serialize(game.state));
    expect(loaded.land).toEqual(game.state.land);
    expect(parcelsBought(loaded.land, FARM_PARCELS, START_LAND)).toBe(1);
  });
});
