import { describe, expect, it } from 'vitest';
import { CROPS, FIELD } from '../data/crops';
import { START_LAND } from './constants';
import { cropStage, formatDuration, growthProgress, harvest, plant, STARTING_FIELDS, timeToRipe, type FieldState } from './crops';
import { Game } from './game';
import { deserialize, serialize } from './save';
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
    const game = new Game();
    const fields = game.objectsOfType(FIELD);
    expect(fields.map((f) => [f.x, f.y])).toEqual(STARTING_FIELDS.map((p) => [p.x, p.y]));
    expect(fields.map((f) => f.state)).toEqual([
      { crop: null, timer: null },
      { crop: null, timer: null },
    ]);
    expect(game.money).toBe(500); // starting fields are free
  });

  it('builds a field for $25, only on free owned land', () => {
    const game = new Game();
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
    const game = new Game();
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
    const game = new Game();
    game.state.money = 5;
    const field = firstField(game);
    expect(plant(game, field, 'wheat')).toEqual({ ok: false, reason: 'money' });
    expect(game.money).toBe(5);
    expect(cropStage(game.state.clock, field.state)).toBe('empty');
  });

  it('refuses a planted field and unknown crops', () => {
    const game = new Game();
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
    const game = new Game();
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
    const game = new Game();
    const field = firstField(game);
    plant(game, field, 'corn'); // 60 s of game time
    game.setSpeed(10);
    for (let i = 0; i < 59; i++) game.tick(100); // 5.9 s real
    expect(cropStage(game.state.clock, field.state)).toBe('growing');
    game.tick(100); // 6 s real
    expect(cropStage(game.state.clock, field.state)).toBe('ripe');
  });

  it('keeps the crop and its progress across save and load', () => {
    const game = new Game();
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
    expect(state.objects).toEqual([{ id: 'o1', type: FIELD, x: START_LAND.x, y: START_LAND.y, state: { crop: null, timer: null } }]);
  });
});

describe('harvest', () => {
  it('cycles empty → planted → ripe → harvested into the inventory → empty', () => {
    const game = new Game();
    const field = firstField(game);
    const stage = () => cropStage(game.state.clock, field.state);
    expect(stage()).toBe('empty');
    plant(game, field, 'wheat');
    expect(stage()).toBe('seeded');
    expect(harvest(game, field)).toBeNull(); // not ripe yet
    expect(game.count('wheat')).toBe(0);
    run(game, CROPS.wheat.growMs);
    expect(stage()).toBe('ripe');
    expect(harvest(game, field)).toEqual({ crop: CROPS.wheat, qty: 4 });
    expect(game.count('wheat')).toBe(4);
    expect(stage()).toBe('empty');
    expect(field.state).toEqual({ crop: null, timer: null });
    expect(harvest(game, field)).toBeNull();
    expect(game.count('wheat')).toBe(4);
  });

  it('yields 4 of each crop', () => {
    for (const crop of Object.values(CROPS)) {
      const game = new Game();
      const field = firstField(game);
      plant(game, field, crop.id);
      run(game, crop.growMs);
      harvest(game, field);
      expect(game.count(crop.harvestItem)).toBe(4);
    }
  });
});
