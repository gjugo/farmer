import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CROPS, FIELD } from '../data/crops';
import { FALLOW_GAIN_PER_DAY, MANURE_GAIN, MANURE_PER_SPREAD, SOIL_QUALITY } from '../data/soil';
import { buyAnimal, collect, feedAll, type PenState } from './animals';
import { DAY_MS, MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { checkFertilise, fertilise, fertilityOf, fieldSoil, harvest, harvestYield, plant, STARTING_FIELDS, type FieldState } from './crops';
import { Game } from './game';
import { setOwned } from './land';
import { catchUp } from './offline';
import { SEASON_MS } from './seasons';
import { afterHarvest, areaSoil, drainOf, restedFertility, soilAt, soilBand, START_PATCH, yieldAt } from './soil';
import { maxLevelState, stockMaterials } from './test-utils';
import type { PlacedObject } from './types';
import { workplaceNext } from './work';
import { assignFarmer, PLAN_FALLOW, setCropPlan } from './workers';

const field = (game: Game, i = 0) => game.objectsOfType(FIELD)[i] as PlacedObject<FieldState>;

/** A top-level farm owning the whole map, with plenty of money and a big granary and storehouse (empty). */
function farm(): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  for (const [type, x] of [['granary', 0], ['storehouse', 2]] as const) {
    const r = game.place(type, x, 0);
    if (!r.ok) throw new Error(r.reason);
    r.object.state.level = 3;
  }
  for (const id of ['wood', 'stone', 'iron']) delete game.state.inventory[id];
  return game;
}

/** Grows `crop` in the field and harvests it at once (no rest in between). */
function growAndHarvest(game: Game, obj: PlacedObject<FieldState>, crop: keyof typeof CROPS): number {
  expect(plant(game, obj, crop)).toEqual({ ok: true });
  game.state.clock.elapsed += CROPS[crop].growMs;
  const r = harvest(game, obj);
  if (!r.ok) throw new Error(r.reason);
  return r.qty;
}

describe('soil quality layer', () => {
  it('is the same on every load: computed from a fixed seed, never saved', async () => {
    const all = (at: (x: number, y: number) => number) => Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, (_, i) => at(i % MAP_WIDTH, Math.floor(i / MAP_WIDTH)));
    const first = all(soilAt);
    vi.resetModules();
    const fresh = await import('./soil');
    expect(all(fresh.soilAt)).toEqual(first);
    expect(JSON.stringify(new Game().state)).not.toContain('soil');
  });

  it('has rich, normal and poor ground, mostly normal, in smooth blobs rather than noise', () => {
    const counts = { rich: 0, normal: 0, poor: 0 };
    let same = 0;
    let pairs = 0;
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const q = soilAt(x, y);
        expect(Object.values(SOIL_QUALITY)).toContain(q);
        counts[soilBand(q)]++;
        for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
          if (nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
          pairs++;
          if (soilAt(nx, ny) === q) same++;
        }
      }
    }
    const total = MAP_WIDTH * MAP_HEIGHT;
    expect(counts.normal / total).toBeGreaterThan(0.5);
    expect(counts.rich / total).toBeGreaterThan(0.05);
    expect(counts.poor / total).toBeGreaterThan(0.05);
    // Neighbours nearly always share a band: blobs, not salt and pepper.
    expect(same / pairs).toBeGreaterThan(0.9);
  });

  it('gives the starting land one rich patch, under the starting fields, and mostly normal ground elsewhere', () => {
    for (const { x, y } of STARTING_FIELDS) expect(areaSoil({ x, y, w: 2, h: 2 })).toBe(SOIL_QUALITY.rich);
    expect(soilAt(Math.floor(START_PATCH.x), Math.floor(START_PATCH.y))).toBe(SOIL_QUALITY.rich);
    const counts = { rich: 0, normal: 0, poor: 0 };
    for (let y = START_LAND.y; y < START_LAND.y + START_LAND.h; y++) {
      for (let x = START_LAND.x; x < START_LAND.x + START_LAND.w; x++) {
        const band = soilBand(soilAt(x, y));
        counts[band]++;
        // Every rich tile of the starting land belongs to the one patch.
        if (band === 'rich') expect(Math.hypot(x + 0.5 - START_PATCH.x, y + 0.5 - START_PATCH.y)).toBeLessThan(START_PATCH.radius);
      }
    }
    expect(counts.rich).toBeGreaterThanOrEqual(12); // the starting fields and room for another field beside them
    expect(counts.normal).toBeGreaterThan(0.75 * START_LAND.w * START_LAND.h);
  });

  it('is normal off the map', () => {
    expect(soilAt(-1, 0)).toBe(SOIL_QUALITY.normal);
    expect(soilAt(MAP_WIDTH, 0)).toBe(SOIL_QUALITY.normal);
  });
});

describe('field fertility', () => {
  it('a new field starts at the average soil quality of its tiles', () => {
    const game = farm();
    // Straddling the rich patch's edge: two rich tiles and two normal ones somewhere along it.
    let spot: { x: number; y: number } | null = null;
    for (let y = START_LAND.y; y < START_LAND.y + START_LAND.h && !spot; y++) {
      for (let x = START_LAND.x; x < START_LAND.x + START_LAND.w && !spot; x++) {
        const q = areaSoil({ x, y, w: 2, h: 2 });
        if (q > SOIL_QUALITY.normal && q < SOIL_QUALITY.rich && game.checkPlacement(FIELD, x, y).ok) spot = { x, y };
      }
    }
    expect(spot).not.toBeNull();
    const r = game.place(FIELD, spot!.x, spot!.y);
    if (!r.ok) throw new Error(r.reason);
    const f = r.object as PlacedObject<FieldState>;
    const tiles = [soilAt(spot!.x, spot!.y), soilAt(spot!.x + 1, spot!.y), soilAt(spot!.x, spot!.y + 1), soilAt(spot!.x + 1, spot!.y + 1)];
    expect(f.state.fertility).toBe(tiles.reduce((a, b) => a + b) / 4);
    expect(f.state.lastCrop).toBeNull();
    expect(fertilityOf(game.state.clock, f)).toBe(fieldSoil(f));
  });

  it('yield is round(harvestQty × (0.5 + 0.75 × fertility)): about ×1 on normal soil, ×1.2 rich, ×0.85 poor', () => {
    expect(yieldAt(10, SOIL_QUALITY.normal)).toBe(10); // 10.25
    expect(yieldAt(10, SOIL_QUALITY.rich)).toBe(12); // 12.125
    expect(yieldAt(10, SOIL_QUALITY.poor)).toBe(8); // 8.375
    expect(yieldAt(12, SOIL_QUALITY.rich)).toBe(15); // 14.55
    expect(yieldAt(10, 0)).toBe(5);
    expect(yieldAt(10, 100)).toBe(13); // 12.5 rounds up

    const game = farm();
    const f = field(game);
    f.state.fertility = 40;
    plant(game, f, 'corn');
    game.state.clock.elapsed += CROPS.corn.growMs;
    expect(harvestYield(game.state.clock, f)).toBe(10); // 12 × 0.8 = 9.6
    expect(harvest(game, f)).toMatchObject({ ok: true, qty: 10 });
    expect(game.count('corn')).toBe(10);
  });

  it('a harvest is refused when the granary cannot hold the whole yield', () => {
    const game = farm();
    const f = field(game); // rich: 12 wheat
    plant(game, f, 'wheat');
    game.state.clock.elapsed += CROPS.wheat.growMs;
    game.state.inventory.feed = game.spaceFor('feed') - 11; // room for 11 only
    expect(harvest(game, f)).toEqual({ ok: false, reason: 'full' });
    expect(f.state.crop).toBe('wheat');
    expect(workplaceNext(game, f)).toEqual({ wait: 'full' });
  });

  it('each harvest drains the crop’s own amount; the same crop again drains double', () => {
    expect(drainOf('wheat', CROPS.wheat.soilDrain, null)).toBe(8);
    expect(drainOf('wheat', CROPS.wheat.soilDrain, 'corn')).toBe(8);
    expect(drainOf('wheat', CROPS.wheat.soilDrain, 'wheat')).toBe(16);
    expect(afterHarvest(5, 12)).toBe(0);

    const game = farm();
    const f = field(game);
    growAndHarvest(game, f, 'wheat');
    expect(f.state).toMatchObject({ fertility: 87, lastCrop: 'wheat' });
    growAndHarvest(game, f, 'wheat');
    expect(f.state.fertility).toBe(71); // −16: the same crop again
    growAndHarvest(game, f, 'wheat');
    expect(f.state.fertility).toBe(55);
  });

  it('alternating crops drains single', () => {
    const game = farm();
    const f = field(game);
    growAndHarvest(game, f, 'wheat');
    growAndHarvest(game, f, 'carrot');
    growAndHarvest(game, f, 'wheat');
    growAndHarvest(game, f, 'corn');
    expect(f.state).toMatchObject({ fertility: 95 - 8 - 5 - 8 - 12, lastCrop: 'corn' });
  });

  it('an empty field recovers toward its soil quality over game time, and not while a crop grows', () => {
    expect(restedFertility(50, 0, 70, DAY_MS)).toBe(50 + FALLOW_GAIN_PER_DAY);
    expect(restedFertility(50, 0, 70, DAY_MS / 2)).toBe(50 + FALLOW_GAIN_PER_DAY / 2);
    expect(restedFertility(50, 0, 70, 100 * DAY_MS)).toBe(70);
    expect(restedFertility(50, null, 70, 100 * DAY_MS)).toBe(50);
    expect(restedFertility(90, 0, 70, 100 * DAY_MS)).toBe(90); // above its soil (manure): stays

    const game = farm();
    const f = field(game);
    growAndHarvest(game, f, 'wheat');
    growAndHarvest(game, f, 'wheat'); // 71
    const clock = game.state.clock;
    clock.elapsed += 2 * DAY_MS;
    expect(fertilityOf(clock, f)).toBe(71 + 2 * FALLOW_GAIN_PER_DAY);
    // Planting settles it; growing adds nothing.
    plant(game, f, 'corn');
    expect(f.state).toMatchObject({ fertility: 83, restingSince: null });
    clock.elapsed += CROPS.corn.growMs;
    expect(fertilityOf(clock, f)).toBe(83);
    harvest(game, f);
    // Winter counts as rest: a whole season empty brings it back to its soil quality.
    clock.elapsed += SEASON_MS;
    expect(fertilityOf(clock, f)).toBe(SOIL_QUALITY.rich);
  });

  describe('at ×1, ×60 and in offline catch-up', () => {
    beforeEach(() => void vi.spyOn(Math, 'random').mockReturnValue(0.5));
    afterEach(() => vi.restoreAllMocks());

    /** Two assigned fields, one on "Best in season" and one left fallow after its first harvest. */
    function setUp(): Game {
      const game = farm();
      expect(assignFarmer(game, field(game, 0).id).ok).toBe(true);
      // The second field rests from a worn state.
      field(game, 1).state.fertility = 30;
      return game;
    }
    const soilOf = (game: Game) => game.objectsOfType(FIELD).map((o) => [fertilityOf(game.state.clock, o as PlacedObject<FieldState>), o.state.lastCrop]);

    it('give the same fertility', () => {
      const span = 1.5 * SEASON_MS;
      const slow = setUp();
      for (let t = 0; t < span; t += 250) slow.tick(250);
      const fast = setUp();
      fast.setSpeed(60);
      for (let t = 0; t < span; t += 250 * 60) fast.tick(250);
      const away = setUp();
      catchUp(away, span);
      expect(slow.state.clock.elapsed).toBe(span);
      expect(fast.state.clock.elapsed).toBe(span);
      expect(away.state.clock.elapsed).toBe(span);
      expect(field(slow).state.lastCrop).not.toBeNull(); // it was farmed
      expect(soilOf(fast)).toEqual(soilOf(slow));
      expect(soilOf(away)).toEqual(soilOf(slow));
      expect(fertilityOf(slow.state.clock, field(slow, 1))).toBe(30 + (FALLOW_GAIN_PER_DAY * span) / DAY_MS);
    });
  });
});

describe('manure', () => {
  it('pens give 1 manure per animal each time their product is collected', () => {
    const game = farm();
    stockMaterials(game.state, 50);
    const r = game.place('coop', START_LAND.x + 1, START_LAND.y + 8);
    if (!r.ok) throw new Error(r.reason);
    const coop = r.object as PlacedObject<PenState>;
    for (let i = 0; i < 3; i++) buyAnimal(game, coop, 'chicken');
    game.addItem('feed', 10);
    feedAll(game, coop);
    game.state.clock.elapsed += 3_600_000;
    expect(collect(game, coop)).toEqual({ egg: 3 });
    expect(game.count('manure')).toBe(3);
    expect(game.count('egg')).toBe(3);
  });

  it('is stored in the storehouse with materials, and "sell everything" keeps it', async () => {
    const { poolOf } = await import('./storage');
    const { sellAll } = await import('./market');
    expect(poolOf('manure')).toBe('materials');
    const game = farm();
    game.addItem('manure', 4);
    game.addItem('wheat', 4);
    sellAll(game);
    expect(game.count('manure')).toBe(4);
    expect(game.count('wheat')).toBe(0);
  });

  it('spreading 4 manure adds 20 points, capped at 100, and is refused without 4 manure or while a crop stands', () => {
    const game = farm();
    const f = field(game);
    f.state.fertility = 50;
    expect(fertilise(game, f)).toEqual({ ok: false, reason: 'manure' });
    game.addItem('manure', 3);
    expect(checkFertilise(game, f)).toEqual({ ok: false, reason: 'manure' });
    game.addItem('manure', 9);
    expect(fertilise(game, f)).toEqual({ ok: true, fertility: 50 + MANURE_GAIN });
    expect(game.count('manure')).toBe(12 - MANURE_PER_SPREAD);
    // Above its soil quality too, up to 100%.
    f.state.fertility = 90;
    expect(fertilise(game, f)).toEqual({ ok: true, fertility: 100 });
    expect(fertilise(game, f)).toEqual({ ok: false, reason: 'fertile' });
    plant(game, f, 'wheat');
    f.state.fertility = 50;
    expect(fertilise(game, f)).toEqual({ ok: false, reason: 'occupied' });
  });

  it('an assigned farmer spreads it on a worn empty field before ploughing, until it is at 80% or more', () => {
    const game = farm();
    const f = field(game);
    f.state.ploughedAt = null;
    f.state.fertility = 50;
    assignFarmer(game, f.id);
    expect(workplaceNext(game, f)).toMatchObject({ task: { kind: 'plough' } }); // no manure yet
    game.addItem('manure', 8);
    expect(workplaceNext(game, f)).toMatchObject({ task: { kind: 'fertilise', workMs: 20_000 } });
    const kinds: string[] = [];
    game.activity.on('workStarted', ({ kind }) => kinds.push(kind));
    for (let t = 0; t < 5 * 60_000; t += 250) game.tick(250);
    expect(kinds.slice(0, 3)).toEqual(['fertilise', 'fertilise', 'plough']);
    expect(game.count('manure')).toBe(0);
    expect(f.state.crop).not.toBeNull();
    // 50 + 20 + 20, plus the rest it had (rich soil, 95%) until it was sown.
    expect(f.state.fertility).toBeGreaterThanOrEqual(90);
    expect(f.state.fertility).toBeLessThan(SOIL_QUALITY.rich);
  });

  it('a fallow field is left alone, manure or not', () => {
    const game = farm();
    const f = field(game);
    f.state.fertility = 50;
    game.addItem('manure', 8);
    assignFarmer(game, f.id);
    setCropPlan(game, f.id, PLAN_FALLOW);
    expect(workplaceNext(game, f)).toEqual({ wait: 'no-plan' });
    for (let t = 0; t < 5 * 60_000; t += 250) game.tick(250);
    expect(f.state.crop).toBeNull();
    expect(game.count('manure')).toBe(8);
  });
});
