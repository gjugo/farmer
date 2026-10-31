import { describe, expect, it } from 'vitest';
import { CROPS, FIELD } from '../data/crops';
import { PLOUGH_COST } from '../data/seasons';
import { START_LAND } from './constants';
import {
  canPloughNow,
  cropStage,
  formatDuration,
  growthProgress,
  harvest,
  isPloughed,
  plant,
  plough,
  ploughedUntil,
  seasonCheck,
  STARTING_FIELDS,
  timeToRipe,
  type FieldState,
} from './crops';
import { Game } from './game';
import { maxLevelState } from './test-utils';
import { deserialize, serialize } from './save';
import { SEASON_MS } from './seasons';
import type { PlacedObject } from './types';

/** Advances game time by `ms` in frame-sized steps at the current speed. */
function run(game: Game, ms: number): void {
  const step = 100 / game.speed;
  for (let t = 0; t < ms; t += 100) game.tick(step);
}

function firstField(game: Game): PlacedObject<FieldState> {
  return game.objectsOfType(FIELD)[0] as PlacedObject<FieldState>;
}

describe('fields', () => {
  it('a new game starts with 2 empty fields on owned land', () => {
    const game = new Game(maxLevelState());
    const fields = game.objectsOfType(FIELD);
    expect(fields.map((f) => [f.x, f.y])).toEqual(STARTING_FIELDS.map((p) => [p.x, p.y]));
    expect(fields.map((f) => f.state)).toEqual([
      { crop: null, timer: null, ploughedAt: 0 },
      { crop: null, timer: null, ploughedAt: 0 },
    ]);
    expect(game.money).toBe(500); // starting fields are free
  });

  it('builds a field for $25, only on free owned land', () => {
    const game = new Game(maxLevelState());
    const x = START_LAND.x + 1;
    const y = START_LAND.y + 4;
    const r = game.place(FIELD, x, y);
    expect(r.ok).toBe(true);
    expect(game.money).toBe(475);
    expect(game.place(FIELD, x + 1, y + 1)).toEqual({ ok: false, reason: 'occupied' });
    expect(game.place(FIELD, START_LAND.x - 1, y)).toEqual({ ok: false, reason: 'locked' });
    expect(game.money).toBe(475);
  });
});

describe('planting', () => {
  it('charges the crop cost', () => {
    const game = new Game(maxLevelState());
    const field = firstField(game);
    expect(plant(game, field, 'wheat')).toEqual({ ok: true });
    expect(game.money).toBe(500 - 8);
    expect(field.state.crop).toBe('wheat');
    expect(cropStage(game.state.clock, field.state)).toBe('seeded');

    const other = game.objectsOfType(FIELD)[1] as PlacedObject<FieldState>;
    plant(game, other, 'corn');
    expect(game.money).toBe(500 - 8 - 16);
  });

  it('refuses when the player cannot afford it and takes no money', () => {
    const game = new Game(maxLevelState());
    game.state.money = 5;
    const field = firstField(game);
    expect(plant(game, field, 'wheat')).toEqual({ ok: false, reason: 'money' });
    expect(game.money).toBe(5);
    expect(cropStage(game.state.clock, field.state)).toBe('empty');
  });

  it('refuses a planted field and unknown crops', () => {
    const game = new Game(maxLevelState());
    const field = firstField(game);
    plant(game, field, 'carrot');
    expect(plant(game, field, 'wheat')).toEqual({ ok: false, reason: 'occupied' });
    expect(plant(game, game.objectsOfType(FIELD)[1] as PlacedObject<FieldState>, 'tomato')).toEqual({
      ok: false,
      reason: 'unknown-crop',
    });
    expect(game.money).toBe(500 - 12);
  });
});

describe('growth', () => {
  it('goes seeded → sprout → growing → ripe over the grow time', () => {
    const game = new Game(maxLevelState());
    const field = firstField(game);
    plant(game, field, 'wheat'); // 30 s
    const stage = () => cropStage(game.state.clock, field.state);
    expect(stage()).toBe('seeded');
    run(game, 7_000);
    expect(stage()).toBe('seeded');
    run(game, 1_000); // 8 s
    expect(stage()).toBe('sprout');
    run(game, 10_000); // 18 s
    expect(stage()).toBe('growing');
    expect(growthProgress(game.state.clock, field.state)).toBeCloseTo(0.6);
    expect(formatDuration(timeToRipe(game.state.clock, field.state))).toBe('0:12');
    run(game, 11_900);
    expect(stage()).toBe('growing');
    run(game, 100); // 30 s
    expect(stage()).toBe('ripe');
    expect(timeToRipe(game.state.clock, field.state)).toBe(0);
  });

  it('grows 10× faster at debug speed ×10', () => {
    const game = new Game(maxLevelState());
    const field = firstField(game);
    plant(game, field, 'corn'); // 60 s of game time
    game.setSpeed(10);
    for (let i = 0; i < 59; i++) game.tick(100); // 5.9 s real
    expect(cropStage(game.state.clock, field.state)).toBe('growing');
    game.tick(100); // 6 s real
    expect(cropStage(game.state.clock, field.state)).toBe('ripe');
  });

  it('keeps the crop and its progress across save and load', () => {
    const game = new Game(maxLevelState());
    plant(game, firstField(game), 'carrot');
    run(game, 20_000);
    const loaded = new Game(deserialize(serialize(game.state)));
    const field = firstField(loaded);
    expect(field.state.crop).toBe('carrot');
    expect(growthProgress(loaded.state.clock, field.state)).toBeCloseTo(20 / 45);
    run(loaded, 25_000);
    expect(cropStage(loaded.state.clock, field.state)).toBe('ripe');
  });

  it('fills defaults for fields saved without crop state', () => {
    const state = deserialize(
      JSON.stringify({ version: 1, state: { objects: [{ id: 'o1', type: FIELD, x: START_LAND.x, y: START_LAND.y }] } }),
    );
    expect(state.objects[0]).toEqual({ id: 'o1', type: FIELD, x: START_LAND.x, y: START_LAND.y, state: { crop: null, timer: null, ploughedAt: 0 } }); // older farms' fields count as ploughed
  });
});

describe('harvest', () => {
  it('cycles empty → planted → ripe → harvested into the inventory → empty', () => {
    const game = new Game(maxLevelState());
    const field = firstField(game);
    const stage = () => cropStage(game.state.clock, field.state);
    expect(stage()).toBe('empty');
    plant(game, field, 'wheat');
    expect(stage()).toBe('seeded');
    expect(harvest(game, field)).toEqual({ ok: false, reason: 'not-ripe' }); // not ripe yet
    expect(game.count('wheat')).toBe(0);
    run(game, CROPS.wheat.growMs);
    expect(stage()).toBe('ripe');
    expect(harvest(game, field)).toEqual({ ok: true, crop: CROPS.wheat, qty: 4 });
    expect(game.count('wheat')).toBe(4);
    expect(stage()).toBe('empty');
    expect(field.state).toEqual({ crop: null, timer: null, ploughedAt: 0 }); // still ploughed
    expect(harvest(game, field)).toEqual({ ok: false, reason: 'not-ripe' });
    expect(game.count('wheat')).toBe(4);
  });

  it('yields 4 of each crop', () => {
    for (const crop of Object.values(CROPS)) {
      const game = new Game(maxLevelState());
      const field = firstField(game);
      plant(game, field, crop.id);
      run(game, crop.growMs);
      harvest(game, field);
      expect(game.count(crop.harvestItem)).toBe(4);
    }
  });
});

describe('seasons and ploughing', () => {
  const SUMMER = SEASON_MS;
  const AUTUMN = 2 * SEASON_MS;
  const WINTER = 3 * SEASON_MS;
  const NEXT_SPRING = 4 * SEASON_MS;

  function newField(game: Game): PlacedObject<FieldState> {
    const r = game.place(FIELD, START_LAND.x + 1, START_LAND.y + 4);
    if (!r.ok) throw new Error(r.reason);
    return r.object as PlacedObject<FieldState>;
  }

  it('a built field must be ploughed ($5) before sowing', () => {
    const game = new Game(maxLevelState());
    const field = newField(game);
    const money = game.money;
    expect(isPloughed(game.state.clock, field.state)).toBe(false);
    expect(plant(game, field, 'wheat')).toEqual({ ok: false, reason: 'unploughed' });
    expect(game.money).toBe(money);

    expect(plough(game, field)).toEqual({ ok: true });
    expect(game.money).toBe(money - PLOUGH_COST);
    expect(isPloughed(game.state.clock, field.state)).toBe(true);
    expect(plough(game, field)).toEqual({ ok: false, reason: 'ploughed' });
    expect(plant(game, field, 'wheat')).toEqual({ ok: true });
    expect(plough(game, field)).toEqual({ ok: false, reason: 'occupied' });
    expect(game.money).toBe(money - PLOUGH_COST - CROPS.wheat.plantCost);
  });

  it('refuses to plough without the money', () => {
    const game = new Game(maxLevelState());
    const field = newField(game);
    game.state.money = PLOUGH_COST - 1;
    expect(plough(game, field)).toEqual({ ok: false, reason: 'money' });
    expect(field.state.ploughedAt).toBeNull();
  });

  it('ploughed soil lasts through harvests until the winter frost; winter ground cannot be ploughed', () => {
    const game = new Game(maxLevelState());
    const field = firstField(game);
    plant(game, field, 'wheat');
    run(game, CROPS.wheat.growMs);
    harvest(game, field);
    expect(isPloughed(game.state.clock, field.state)).toBe(true);
    expect(ploughedUntil(game.state.clock, field.state)).toBe(WINTER);

    game.state.clock.elapsed = WINTER - 1;
    expect(isPloughed(game.state.clock, field.state)).toBe(true);
    game.state.clock.elapsed = WINTER;
    expect(isPloughed(game.state.clock, field.state)).toBe(false);
    expect(ploughedUntil(game.state.clock, field.state)).toBeNull();
    expect(canPloughNow(game.state.clock)).toBe(false);
    expect(plough(game, field)).toEqual({ ok: false, reason: 'season' });
    expect(plant(game, field, 'wheat')).toEqual({ ok: false, reason: 'unploughed' });

    game.state.clock.elapsed = NEXT_SPRING;
    expect(canPloughNow(game.state.clock)).toBe(true);
    expect(plough(game, field)).toEqual({ ok: true });
    expect(plant(game, field, 'wheat')).toEqual({ ok: true });
  });

  it('each crop is sown only in its seasons', () => {
    const clock = { elapsed: 0, speed: 1 };
    const sowable = (at: number) => {
      clock.elapsed = at + 1000;
      return Object.values(CROPS).filter((c) => seasonCheck(clock, c) === 'ok').map((c) => c.id);
    };
    expect(sowable(0)).toEqual(['wheat', 'carrot', 'corn']);
    expect(sowable(SUMMER)).toEqual(['wheat', 'corn']);
    expect(sowable(AUTUMN)).toEqual(['wheat', 'carrot']);
    expect(sowable(WINTER)).toEqual([]);

    const game = new Game(maxLevelState());
    const field = firstField(game);
    game.state.clock.elapsed = SUMMER + 1000;
    plough(game, field);
    const money = game.money;
    expect(plant(game, field, 'carrot')).toEqual({ ok: false, reason: 'out-of-season' });
    expect(game.money).toBe(money);
    expect(cropStage(game.state.clock, field.state)).toBe('empty');
  });

  it('refuses a crop that would not be ripe before its seasons end', () => {
    const game = new Game(maxLevelState());
    const field = firstField(game);
    game.state.clock.elapsed = AUTUMN - CROPS.corn.growMs + 1; // corn grows in spring and summer only
    plough(game, field);
    expect(seasonCheck(game.state.clock, CROPS.corn)).toBe('late');
    expect(plant(game, field, 'corn')).toEqual({ ok: false, reason: 'late' });
    expect(plant(game, field, 'wheat')).toEqual({ ok: true }); // wheat goes on into autumn

    game.state.clock.elapsed = AUTUMN - CROPS.corn.growMs;
    expect(seasonCheck(game.state.clock, CROPS.corn)).toBe('ok'); // ripe right at the change
  });

  it('a ripe crop keeps in the field into winter and can still be harvested', () => {
    const game = new Game(maxLevelState());
    const field = firstField(game);
    game.state.clock.elapsed = WINTER - CROPS.wheat.growMs;
    plant(game, field, 'wheat');
    game.state.clock.elapsed = WINTER + 1000;
    expect(cropStage(game.state.clock, field.state)).toBe('ripe');
    expect(harvest(game, field)).toEqual({ ok: true, crop: CROPS.wheat, qty: 4 });
    expect(isPloughed(game.state.clock, field.state)).toBe(false);
  });

  it('keeps ploughing across save and load', () => {
    const game = new Game(maxLevelState());
    const field = newField(game);
    game.state.clock.elapsed = SUMMER + 5000;
    plough(game, field);
    const loaded = new Game(deserialize(serialize(game.state)));
    const f = loaded.getObject(field.id) as PlacedObject<FieldState>;
    expect(f.state.ploughedAt).toBe(SUMMER + 5000);
    expect(isPloughed(loaded.state.clock, f.state)).toBe(true);
  });

  it('fields of a save from before seasons count as ploughed, unless it is winter', () => {
    const v4 = (elapsed: number) =>
      JSON.stringify({
        version: 4,
        savedAt: null,
        state: { clock: { elapsed }, objects: [{ id: 'o1', type: FIELD, x: START_LAND.x, y: START_LAND.y, state: { crop: 'wheat', timer: null } }] },
      });
    const summer = deserialize(v4(SUMMER + 7)).objects[0].state;
    expect(summer).toEqual({ crop: 'wheat', timer: null, ploughedAt: SUMMER + 7 });
    expect(isPloughed({ elapsed: SUMMER + 7, speed: 1 }, summer as FieldState)).toBe(true);
    expect(deserialize(v4(WINTER + 7)).objects[0].state).toEqual({ crop: 'wheat', timer: null, ploughedAt: null });
  });
});
