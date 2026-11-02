import { describe, expect, it } from 'vitest';
import { getBuildable, listBuildMenu } from '../data/buildables';
import { FIELD } from '../data/crops';
import { ITEM_LIST, ITEMS } from '../data/items';
import { formatMaterials, MATERIAL_IDS, MATERIAL_UNLOCK, needsMaterialsMessage } from '../data/materials';
import { GOALS } from '../data/progression';
import { DAY_MS, START_LAND } from './constants';
import { demolishMaterialsRefund, demolishRefund, Game } from './game';
import { buy, buyPrice, dailyPrice, PRICE_MAX_FACTOR, sell, sellAll } from './market';
import { isOrderable } from './orders';
import { PROGRESSION, type ProgressionState } from './progression';
import { deserialize } from './save';
import { getSlice } from './slices';
import { createNewGame } from './state';
import { CAMP_SUPPLIES } from '../data/camp';
import { fromV6, maxLevelState, v6Land, V6_START } from './test-utils';
import { itemUnlockLevel } from './unlocks';

// Free land below the starting fields, the farmhouse and the road between them.
const fx = START_LAND.x;
const fy = START_LAND.y + 4;

/** A level-1 farm on `day` with `inventory` and `money`. */
function farm({ day = 1, money = 500, inventory = {} }: { day?: number; money?: number; inventory?: Record<string, number> } = {}): Game {
  const state = createNewGame();
  state.money = money;
  state.inventory = { ...inventory };
  state.clock.elapsed = (day - 1) * DAY_MS + 1000;
  return new Game(state);
}

describe('material costs', () => {
  it('every buildable but paths, fields and the woodcutter needs wood or stone, and at least two need iron', () => {
    for (const b of listBuildMenu()) {
      if (b.id === 'path' || b.id === FIELD) {
        expect(b.materials, b.id).toBeUndefined();
        continue;
      }
      // Money only, so a new farm can make its own wood.
      if (b.id === 'woodcutter') continue;
      expect((b.materials?.wood ?? 0) + (b.materials?.stone ?? 0), b.id).toBeGreaterThan(0);
    }
    expect(listBuildMenu().filter((b) => (b.materials?.iron ?? 0) > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('a building never needs a material the Market does not sell yet at its unlock level', () => {
    for (const b of listBuildMenu()) {
      for (const id of MATERIAL_IDS) {
        if (b.materials?.[id]) expect(MATERIAL_UNLOCK[id], `${b.id} needs ${id}`).toBeLessThanOrEqual(b.unlockLevel ?? 1);
      }
    }
  });

  it('materials are items in their own category with a price', () => {
    for (const id of MATERIAL_IDS) {
      expect(ITEMS[id].category).toBe('material');
      expect(itemUnlockLevel(id)).toBe(MATERIAL_UNLOCK[id]);
    }
    expect(formatMaterials({ wood: 6, stone: 8, iron: 2 })).toBe('6 🪵 Wood + 8 🪨 Stone + 2 🔩 Iron');
    expect(formatMaterials(undefined)).toBe('');
    expect(needsMaterialsMessage([['wood', 4]])).toBe('Needs 4 more 🪵 Wood: buy it at the 🏪 Market');
    expect(needsMaterialsMessage([['wood', 4], ['stone', 1], ['iron', 2]])).toBe(
      'Needs 4 more 🪵 Wood, 1 more 🪨 Stone and 2 more 🔩 Iron: buy them at the 🏪 Market',
    );
  });
});

describe('placing', () => {
  it('charges the money and the materials exactly', () => {
    const game = farm({ inventory: { wood: 11, stone: 2 } });
    const r = game.place('coop', fx, fy);
    expect(r.ok).toBe(true);
    expect(game.money).toBe(500 - 100);
    expect(game.state.inventory).toEqual({ wood: 3, stone: 2 });
  });

  it('charges every material of a building that needs several', () => {
    const game = new Game(maxLevelState());
    game.state.inventory = { wood: 6, stone: 9, iron: 2, egg: 1 };
    expect(game.place('dairy', fx, fy).ok).toBe(true);
    expect(game.money).toBe(500 - 265);
    expect(game.state.inventory).toEqual({ stone: 1, egg: 1 });
  });

  it('refuses without enough materials and changes nothing', () => {
    const game = farm({ inventory: { wood: 7 } });
    const before = structuredClone(game.state);
    const events: string[] = [];
    for (const e of ['money', 'inventory', 'objectAdded'] as const) game.events.on(e, () => events.push(e));
    expect(game.place('coop', fx, fy)).toEqual({ ok: false, reason: 'materials' });
    expect(game.state).toEqual(before);
    expect(events).toEqual([]);
    expect(game.missingMaterials(getBuildable('coop')!.materials)).toEqual([['wood', 1]]);
    expect(game.canPayFor('coop')).toBe(false);
  });

  it('refuses without enough money and changes nothing, even with the materials', () => {
    const game = farm({ money: 99, inventory: { wood: 8 } });
    const before = structuredClone(game.state);
    expect(game.place('coop', fx, fy)).toEqual({ ok: false, reason: 'money' });
    expect(game.state).toEqual(before);
    expect(game.canPayFor('coop')).toBe(false);
    game.earn(1);
    expect(game.canPayFor('coop')).toBe(true);
  });

  it('paths and fields stay money-only', () => {
    const game = farm();
    expect(game.place('path', fx, fy).ok).toBe(true);
    expect(game.place(FIELD, fx + 2, fy).ok).toBe(true);
    expect(game.state.inventory).toEqual({});
  });
});

describe('demolishing', () => {
  it('refunds half the money and half the materials, rounded down', () => {
    const game = new Game(maxLevelState());
    game.state.inventory = { wood: 6, stone: 8, iron: 2 };
    const r = game.place('dairy', fx, fy);
    if (!r.ok) throw new Error(r.reason);
    const money = game.money;
    expect(game.demolish(r.object.id)).toBe(132);
    expect(game.money).toBe(money + 132);
    expect(game.state.inventory).toEqual({ wood: 3, stone: 4, iron: 1 });
  });

  it('cancelling an unfinished construction site gives back all the money and materials', () => {
    const game = new Game(maxLevelState());
    game.state.inventory = { wood: 6, stone: 8, iron: 2 };
    const money = game.money;
    const r = game.place('dairy', fx, fy, { site: true });
    if (!r.ok) throw new Error(r.reason);
    expect(r.object.site).toBeDefined();
    expect(game.state.inventory).toEqual({});
    expect(game.demolish(r.object.id)).toBe(265);
    expect(game.money).toBe(money);
    expect(game.state.inventory).toEqual({ wood: 6, stone: 8, iron: 2 });
  });

  it('rounds odd amounts down', () => {
    const loom = getBuildable('loom')!;
    expect(loom.materials).toEqual({ wood: 10, iron: 3 });
    expect(demolishMaterialsRefund(loom)).toEqual({ wood: 5, iron: 1 });
    expect(demolishRefund(loom)).toBe(162);
    expect(demolishMaterialsRefund(getBuildable('path'))).toEqual({});
  });
});

describe('buying at the Market', () => {
  it('buy prices sit above what the Market pays, on every day and across days', () => {
    for (const id of MATERIAL_IDS) {
      const best = Math.floor(ITEMS[id].price * PRICE_MAX_FACTOR);
      const seen = new Set<number>();
      for (let day = 1; day <= 365; day++) {
        const price = buyPrice(day, id)!;
        expect(Number.isInteger(price)).toBe(true);
        expect(price).toBeGreaterThan(dailyPrice(day, id)!);
        expect(price).toBeGreaterThan(best);
        seen.add(price);
      }
      // Like sell prices, buy prices change from day to day.
      expect(seen.size, id).toBeGreaterThan(1);
    }
  });

  it('only building materials are for sale (not manure, which pens make, nor the blacksmith’s tools)', () => {
    for (const item of ITEM_LIST) {
      expect(buyPrice(1, item.id) !== null, item.id).toBe(item.category === 'material' && item.id !== 'manure' && item.id !== 'tools');
    }
    expect(buyPrice(1, 'nope')).toBeNull();
  });

  it('charges the day’s price and adds the items', () => {
    const game = farm({ day: 9 });
    const price = buyPrice(9, 'wood')!;
    const bought: unknown[] = [];
    game.activity.on('bought', (e) => bought.push(e));
    expect(buy(game, 'wood', 5)).toEqual({ ok: true, qty: 5, spent: 5 * price });
    expect(game.money).toBe(500 - 5 * price);
    expect(game.count('wood')).toBe(5);
    expect(bought).toEqual([{ item: 'wood', qty: 5, spent: 5 * price }]);
  });

  it('with too little money changes nothing', () => {
    const price = buyPrice(1, 'stone')!;
    const game = farm({ money: 10 * price - 1 });
    const before = structuredClone(game.state);
    expect(buy(game, 'stone', 10)).toEqual({ ok: false, reason: 'money' });
    expect(game.state).toEqual(before);
  });

  it('sells iron only from its unlock level', () => {
    const game = farm({ money: 1000 });
    expect(buy(game, 'iron', 1)).toEqual({ ok: false, reason: 'level' });
    expect(game.money).toBe(1000);
    game.progression.setLevel(MATERIAL_UNLOCK.iron);
    const money = game.money;
    expect(buy(game, 'iron', 1).ok).toBe(true);
    expect(game.money).toBe(money - buyPrice(game.day, 'iron')!);
  });

  it('refuses anything that is not a material, and nonsense amounts', () => {
    const game = farm();
    expect(buy(game, 'wheat', 1)).toEqual({ ok: false, reason: 'not-for-sale' });
    expect(buy(game, 'wood', 0)).toEqual({ ok: false, reason: 'not-for-sale' });
    expect(game.money).toBe(500);
  });

  it('"sell everything" keeps the materials', () => {
    const game = farm({ inventory: { wood: 3, egg: 2 } });
    expect(sellAll(game)).toBe(2 * dailyPrice(1, 'egg')!);
    expect(game.state.inventory).toEqual({ wood: 3 });
  });

  it('buying and selling back always loses money and gives no XP', () => {
    for (let day = 1; day <= 60; day++) {
      const game = farm({ day });
      buy(game, 'wood', 10);
      const xp = game.progression.xp;
      sell(game, 'wood');
      expect(game.money, `day ${day}`).toBeLessThan(500);
      expect(game.progression.xp).toBe(xp);
    }
  });
});

describe('goals, orders and saves', () => {
  it('"Build a trading post" sits where "Buy 10 wood" was (saves keep goals by index), before the cottage and the coop', () => {
    const at = GOALS.findIndex((g) => g.id === 'build-trading-post');
    expect(at).toBe(4);
    expect(GOALS.some((g) => g.id === 'buy-wood')).toBe(false);
    expect(GOALS.slice(at + 1, at + 3).map((g) => g.id)).toEqual(['build-cottage', 'build-coop']);
    const game = farm();
    getSlice<ProgressionState>(game.state, PROGRESSION).goals = [{ id: 'build-trading-post', progress: 0 }];
    game.earn(100);
    game.addItem('wood', 10);
    const spot = [...Array(START_LAND.w * START_LAND.h).keys()]
      .map((i) => ({ x: START_LAND.x + (i % START_LAND.w), y: START_LAND.y + Math.floor(i / START_LAND.w) }))
      .find((t) => game.checkPlacement('trading-post', t.x, t.y).ok)!;
    expect(game.place('trading-post', spot.x, spot.y).ok).toBe(true);
    expect(game.progression.goals()[0].complete).toBe(true);
  });

  it('orders never ask for materials', () => {
    for (const id of MATERIAL_IDS) expect(isOrderable(ITEMS[id])).toBe(false);
  });

  it("a new farm's only materials are the starting camp's supplies", () => {
    const inventory = createNewGame().inventory;
    for (const id of MATERIAL_IDS) expect(inventory[id]).toBe(CAMP_SUPPLIES[id]);
  });

  it('an old save loads with no materials and its buildings untouched', () => {
    // Version-5 coordinates: the 32×24 map with its starting land at (11, 8).
    const coop = { id: 'o1', type: 'coop', x: V6_START.x, y: V6_START.y + 4, state: { animals: [{ kind: 'chicken', fedAt: null }] } };
    const file = {
      version: 5,
      savedAt: null,
      state: { land: v6Land(), objects: [coop], nextObjectId: 2, inventory: { egg: 2 }, ext: { [PROGRESSION]: { xp: 0, goals: [], nextGoal: 3 } } },
    };
    const loaded = deserialize(JSON.stringify(file));
    expect(loaded.inventory).toEqual({ egg: 2 });
    // Its hungry chicken notes that it is hungry from the load on (version 19, winter feeding).
    expect(loaded.objects[0]).toEqual({ ...coop, ...fromV6(coop.x, coop.y), state: { animals: [{ kind: 'chicken', fedAt: null, hungrySince: 0 }] } });
    // Not yet at the coop goal: the new "buy wood" goal comes next.
    // The slot "buy-wood" was in is "Build a trading post" since version 16.
    expect(GOALS[getSlice<ProgressionState>(loaded, PROGRESSION).nextGoal].id).toBe('build-trading-post');
  });

  it('an old save past the coop goal keeps its next goal and skips "buy wood"', () => {
    // In version 5 the goal at index 5 was "collect-eggs"; it moved one place down.
    const file = { version: 5, savedAt: null, state: { land: v6Land(), ext: { [PROGRESSION]: { xp: 0, goals: [], nextGoal: 5 } } } };
    const loaded = deserialize(JSON.stringify(file));
    expect(GOALS[getSlice<ProgressionState>(loaded, PROGRESSION).nextGoal].id).toBe('collect-eggs');
  });
});
