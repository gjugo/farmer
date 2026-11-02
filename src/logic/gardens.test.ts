import { describe, expect, it } from 'vitest';
import { COTTAGE, FOODS, MEAL_PER_FAMILY } from '../data/families';
import { GARDEN_APPROVAL, GARDENS, GARDEN_TYPES } from '../data/gardens';
import { getItem } from '../data/items';
import { SEASONS } from '../data/seasons';
import { NO_FARMER_BUILDABLES } from '../data/workers';
import { DAY_MS } from './constants';
import { approvalOf, familiesOf, YEAR_MS, type DayNeeds } from './families';
import { Game } from './game';
import { gardenHomes, gardensOf, gardenOf, nextYieldAt, type GardenState } from './gardens';
import { catchUp } from './offline';
import { farmhouseOf } from './roads';
import { SEASON_MS } from './seasons';
import { capacity, used } from './storage';
import { maxLevelState } from './test-utils';
import type { GameState, PlacedObject } from './types';
import { runWork } from './work';

const SUMMER = SEASON_MS;
const AUTUMN = 2 * SEASON_MS;
const WINTER = 3 * SEASON_MS;

/** A farm at the top level, with plenty of money and materials. */
function farm(): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  return game;
}

/** The farmhouse's tiles: gardens go beside them. */
function house(game: Game) {
  const h = farmhouseOf(game.state)!;
  return { x: h.x, y: h.y };
}

/** Places `type` at (x, y) or fails the test. */
function put(game: Game, type: string, x: number, y: number): PlacedObject<GardenState> {
  const r = game.place(type, x, y, { site: true });
  if (!r.ok) throw new Error(`could not place ${type} at ${x},${y}: ${r.reason}`);
  return r.object as unknown as PlacedObject<GardenState>;
}

/** A cottage far from the farmhouse, so gardens beside it touch only it. */
function cottage(game: Game, x = 4, y = 4): PlacedObject {
  const r = game.place(COTTAGE, x, y);
  if (!r.ok) throw new Error(`could not place a cottage: ${r.reason}`);
  return r.object;
}

/** Runs the farm to game time `t` (one scheduler run, as a frame does). */
function runTo(game: Game, t: number): void {
  runWork(game, t);
}

const day = (over: Partial<DayNeeds>): DayNeeds => ({
  families: 1,
  ate: {},
  eaten: 2,
  meal: 2,
  variety: 1,
  firewood: null,
  firewoodNeeded: 1,
  clothed: null,
  ...over,
});

describe('gardens: content', () => {
  it('apples are a new food, sold as a crop', () => {
    expect(getItem('apple')).toMatchObject({ category: 'crop', icon: '🍎' });
    expect(getItem('apple')!.price).toBeGreaterThanOrEqual(6);
    expect(getItem('apple')!.price).toBeLessThanOrEqual(8);
    expect(FOODS).toContain('apple');
  });

  it('each garden feeds about half a family at most, and needs no farmer to build', () => {
    for (const type of GARDEN_TYPES) {
      const def = GARDENS[type];
      const perYear = SEASONS.reduce((sum, s) => sum + (def.perDay[s] ?? 0), 0) * (YEAR_MS / SEASONS.length / DAY_MS);
      const perDay = perYear / (YEAR_MS / DAY_MS);
      expect(perDay, type).toBeGreaterThan(0);
      expect(perDay, type).toBeLessThanOrEqual(MEAL_PER_FAMILY / 2);
      expect(NO_FARMER_BUILDABLES).toContain(type);
      expect(def.footprint).toEqual({ w: 2, h: 2 });
    }
    expect(GARDENS['veg-patch'].perDay.winter ?? 0).toBe(0);
    expect(SEASONS.filter((s) => (GARDENS.orchard.perDay[s] ?? 0) > 0)).toEqual(['autumn']);
  });
});

describe('gardens: placement', () => {
  it('must touch a home along an edge', () => {
    const game = farm();
    const h = house(game);
    // Corner to corner is not along an edge.
    expect(game.checkPlacement('veg-patch', h.x + 3, h.y - 2)).toEqual({ ok: false, reason: 'needs-home' });
    // A tile away is not touching.
    expect(game.checkPlacement('veg-patch', h.x + 4, h.y)).toEqual({ ok: false, reason: 'needs-home' });
    // Against the farmhouse's right side, half beside it, is fine.
    expect(game.checkPlacement('veg-patch', h.x + 3, h.y + 1)).toEqual({ ok: true });
    // Beside a cottage too.
    const c = cottage(game);
    expect(game.checkPlacement('hen-run', c.x + 2, c.y)).toEqual({ ok: true });
    expect(game.checkPlacement('hen-run', c.x, c.y + 2)).toEqual({ ok: true });
  });

  it('one garden per home', () => {
    const game = farm();
    const c = cottage(game);
    const patch = put(game, 'veg-patch', c.x + 2, c.y);
    expect(gardenHomes(game.state).get(patch.id)).toBe(c.id);
    expect(game.checkPlacement('orchard', c.x, c.y + 2)).toEqual({ ok: false, reason: 'home-has-garden' });
    expect(game.place('orchard', c.x, c.y + 2).ok).toBe(false);
    // A garden between two homes can still go when one of them is free.
    const c2 = cottage(game, c.x + 4, c.y);
    expect(game.checkPlacement('orchard', c.x + 4, c.y + 2)).toEqual({ ok: true });
    const orchard = put(game, 'orchard', c.x + 4, c.y + 2);
    expect(gardenHomes(game.state).get(orchard.id)).toBe(c2.id);
    expect(gardenOf(game.state, c2.id)?.id).toBe(orchard.id);
  });

  it('is finished at once: the family lays it out, no farmer or path', () => {
    const game = farm();
    const c = cottage(game);
    const g = put(game, 'veg-patch', c.x + 2, c.y);
    expect(g.site).toBeUndefined();
  });
});

describe('gardens: yields', () => {
  /** A farm at game time `t` with a cottage and a garden of `type` beside it. The families skip their meals, so the yield stays in store. */
  function withGarden(type: string, t: number) {
    const game = farm();
    game.state.clock.elapsed = t;
    familiesOf(game.state).settledDay = Number.MAX_SAFE_INTEGER;
    const c = cottage(game);
    const g = put(game, type, c.x + 2, c.y);
    runTo(game, t);
    return { game, c, g };
  }

  it('yields once a day after it is built, by the season, into the granary', () => {
    const { game, g } = withGarden('veg-patch', SUMMER + 1000);
    expect(g.state.nextAt).toBe(SUMMER + 1000 + DAY_MS);
    const before = game.count('carrot');
    runTo(game, SUMMER + 1000 + 3 * DAY_MS);
    expect(game.count('carrot') - before).toBe(3 * GARDENS['veg-patch'].perDay.summer!);
    expect(g.state.waiting).toBe(0);
  });

  it('the vegetable patch is idle in winter; the hen run lays all year; the orchard bears in autumn', () => {
    const veg = withGarden('veg-patch', WINTER);
    runTo(veg.game, WINTER + 4 * DAY_MS);
    expect(veg.game.count('carrot')).toBe(0);
    // Its next yield is the first day of spring.
    expect(nextYieldAt(veg.g)).toBe(YEAR_MS + DAY_MS);

    const hens = withGarden('hen-run', WINTER);
    runTo(hens.game, WINTER + 4 * DAY_MS);
    expect(hens.game.count('egg')).toBe(4 * GARDENS['hen-run'].perDay.winter!);

    const orchard = withGarden('orchard', SUMMER);
    runTo(orchard.game, AUTUMN);
    expect(orchard.game.count('apple')).toBe(0);
    runTo(orchard.game, WINTER);
    expect(orchard.game.count('apple')).toBe(4 * GARDENS.orchard.perDay.autumn!);
    runTo(orchard.game, WINTER + 2 * DAY_MS);
    expect(orchard.game.count('apple')).toBe(4 * GARDENS.orchard.perDay.autumn!);
  });

  it('what does not fit waits in the garden and goes in once there is room', () => {
    const { game, g } = withGarden('hen-run', SUMMER);
    // Fill the granary pool to the brim.
    game.state.inventory.wheat = (game.state.inventory.wheat ?? 0) + capacity(game.state, 'goods') - used(game.state, 'goods');
    runTo(game, SUMMER + 3 * DAY_MS);
    expect(game.count('egg')).toBe(0);
    expect(g.state.waiting).toBe(3);
    // Sell some wheat: the eggs go in at the next step, none lost.
    game.removeItem('wheat', 2);
    runTo(game, game.now + 1);
    expect(game.count('egg')).toBe(2);
    expect(g.state.waiting).toBe(1);
  });

  it('a garden without a home yields nothing, and stops when its home is demolished', () => {
    const { game, c, g } = withGarden('veg-patch', SUMMER);
    runTo(game, SUMMER + DAY_MS);
    expect(game.count('carrot')).toBe(1);
    game.demolish(c.id);
    runTo(game, SUMMER + 4 * DAY_MS);
    expect(game.count('carrot')).toBe(1);
    expect(g.state.home).toBeNull();
    expect(g.state.nextAt).toBeNull();
    // Rebuilding a home beside it starts it again.
    cottage(game, c.x, c.y);
    runTo(game, game.now + 1);
    expect(g.state.home).not.toBeNull();
    runTo(game, game.now + DAY_MS);
    expect(game.count('carrot')).toBe(2);
  });

  it('counts toward the "gather apples" goal through the gathered activity', () => {
    const { game } = withGarden('orchard', AUTUMN);
    let gathered = 0;
    game.activity.on('gathered', ({ item, qty }) => item === 'apple' && (gathered += qty));
    runTo(game, AUTUMN + 3 * DAY_MS);
    expect(gathered).toBe(3 * GARDENS.orchard.perDay.autumn!);
  });
});

describe('gardens: ×60 and offline catch-up agree', () => {
  function setup(): Game {
    const game = farm();
    game.state.clock.elapsed = SUMMER + 12_345;
    const h = house(game);
    put(game, 'veg-patch', h.x + 3, h.y);
    const c = cottage(game);
    put(game, 'hen-run', c.x + 2, c.y);
    const c2 = cottage(game, c.x + 6, c.y);
    put(game, 'orchard', c2.x, c2.y + 2);
    // A nearly full granary, so some of the yield waits on the way.
    game.state.inventory.wheat = (game.state.inventory.wheat ?? 0) + capacity(game.state, 'goods') - used(game.state, 'goods') - 10;
    return game;
  }

  const snapshot = (state: GameState) => ({
    gardens: gardensOf(state).map((g) => ({ ...g.state })),
    inventory: { ...state.inventory },
    families: { ...familiesOf(state), lastDay: null },
    clock: state.clock.elapsed,
  });

  it('a game fortnight at ×60 and the same span offline give the same gardens and granary', () => {
    const live = setup();
    const away = setup();
    const span = 14 * DAY_MS;
    const to = live.now + span;
    live.setSpeed(60);
    while (live.now < to) live.tick(Math.min(250, (to - live.now) / 60));
    const gathered: Record<string, number> = {};
    away.activity.on('gathered', ({ item, qty }) => (gathered[item] = (gathered[item] ?? 0) + qty));
    catchUp(away, span);
    expect(snapshot(live.state)).toEqual(snapshot(away.state));
    // Every kind yielded on the way (the families ate some of it).
    expect(Object.keys(gathered).sort()).toEqual(['apple', 'carrot', 'egg']);
  });
});

describe('gardens: approval', () => {
  it('+5 when every home has a garden, a share of it otherwise, nothing before gardens are unlocked', () => {
    const part = (d: DayNeeds) => approvalOf(d).breakdown.find((p) => p.id === 'gardens');
    expect(part(day({ gardens: { homes: 2, gardened: 2 } }))?.points).toBe(GARDEN_APPROVAL);
    expect(part(day({ gardens: { homes: 4, gardened: 2 } }))?.points).toBe(Math.round(GARDEN_APPROVAL / 2));
    expect(part(day({ gardens: { homes: 3, gardened: 0 } }))?.points).toBe(0);
    expect(part(day({ gardens: null }))).toBeUndefined();
    expect(part(day({}))).toBeUndefined();
    expect(approvalOf(day({ gardens: { homes: 1, gardened: 1 } })).approval).toBe(approvalOf(day({})).approval + GARDEN_APPROVAL);
  });

  it('the families count the homes with a garden at the next day', () => {
    const game = farm();
    const h = house(game);
    put(game, 'hen-run', h.x + 3, h.y);
    cottage(game);
    runTo(game, DAY_MS + 1);
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'gardens')).toMatchObject({ label: 'Gardens at 1 of 2 homes', points: 3 });
  });
});
