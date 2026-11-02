import { describe, expect, it } from 'vitest';
import { MEAL_PER_FAMILY } from '../data/families';
import { familiesCount } from './families';
import { Game } from './game';
import { SEASON_MS } from './seasons';
import { suppliesOf, supplyDays, type SuppliesInput } from './supplies';

const base: SuppliesInput = { food: 0, families: 2, wood: 0, homes: 2, winter: false, firewoodPerHome: 1 };

describe('supplyDays', () => {
  it('counts whole days of food at today’s use', () => {
    // 2 families eat 2 × MEAL_PER_FAMILY a day.
    const perDay = 2 * MEAL_PER_FAMILY;
    expect(supplyDays({ ...base, food: perDay * 5 }).days).toBe(5);
    expect(supplyDays({ ...base, food: perDay * 5 + perDay - 1 }).days).toBe(5);
    expect(supplyDays({ ...base, food: perDay - 1 }).days).toBe(0);
    expect(supplyDays({ ...base, food: 40 })).toMatchObject({ limit: 'food', food: { stock: 40, perDay }, firewood: null });
  });

  it('ignores firewood outside winter', () => {
    expect(supplyDays({ ...base, food: 400, wood: 0 }).days).toBe(100);
  });

  it('takes the lower of food and firewood in winter', () => {
    const winter = { ...base, winter: true };
    // 2 homes burn 2 wood a day: 6 wood lasts 3 days, before 100 days of food.
    expect(supplyDays({ ...winter, food: 400, wood: 6 })).toMatchObject({ days: 3, limit: 'firewood', firewood: { perDay: 2, days: 3 } });
    // Plenty of wood: food runs out first.
    expect(supplyDays({ ...winter, food: 8, wood: 100 })).toMatchObject({ days: 2, limit: 'food' });
  });

  it('burns firewood only for occupied homes, rounded up per day', () => {
    // 3 homes but 2 families; half a wood per home (Warm hearths) is 1 a day.
    expect(supplyDays({ ...base, winter: true, homes: 3, food: 400, wood: 5, firewoodPerHome: 0.5 }).firewood).toEqual({ stock: 5, perDay: 1, days: 5 });
    // A harsh winter doubles it.
    expect(supplyDays({ ...base, winter: true, food: 400, wood: 5, firewoodPerHome: 2 }).firewood).toMatchObject({ perDay: 4, days: 1 });
  });

  it('has no number when nobody eats', () => {
    expect(supplyDays({ ...base, families: 0, food: 10, winter: true, wood: 0 })).toMatchObject({ days: null, limit: null });
  });
});

describe('suppliesOf', () => {
  it('reads the farm: every food kind, and wood in winter', () => {
    const game = new Game();
    const families = familiesCount(game.state);
    for (const id of Object.keys(game.state.inventory)) game.state.inventory[id] = 0;
    game.state.inventory.wheat = 6 * families * MEAL_PER_FAMILY;
    game.state.inventory.egg = 2 * families * MEAL_PER_FAMILY;
    game.state.inventory.wood = 0;
    expect(suppliesOf(game.state)).toMatchObject({ days: 8, limit: 'food', firewood: null });
    game.state.clock.elapsed = 3 * SEASON_MS; // the first winter
    expect(suppliesOf(game.state)).toMatchObject({ days: 0, limit: 'firewood' });
  });
});
