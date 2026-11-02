import { describe, expect, it } from 'vitest';
import { ANIMALS, PENS } from '../data/animals';
import { listBuildables, listBuildMenu } from '../data/buildables';
import { CROP_LIST, CROPS, FIELD, getCrop } from '../data/crops';
import { PROCESSORS } from '../data/processing';
import { ACTIVE_GOALS, GOALS, LEVEL_BONUS, LEVEL_XP, MAX_LEVEL } from '../data/progression';
import { buyAnimal, collect as collectAnimals, feedAll, type PenState } from './animals';
import { START_LAND } from './constants';
import { harvest, plant, type FieldState } from './crops';
import { Game } from './game';
import { sell } from './market';
import { buyParcel, FARM_PARCELS, parcelsForSale } from './parcels';
import { inputsOf } from './processing';
import { PROGRESSION, type ProgressionState } from './progression';
import { deserialize, serialize } from './save';
import { getSlice } from './slices';
import { addStartingObject, createNewGame } from './state';
import { SEASON_MS } from './seasons';
import { bareMap, maxLevelState, stockMaterials } from './test-utils';
import type { PlacedObject } from './types';
import { itemUnlockLevel, levelForXp, requiredLevel, unlocksAt, xpForLevel } from './unlocks';

const free = { x: START_LAND.x + 1, y: START_LAND.y + 8 };

function fields(game: Game): PlacedObject<FieldState>[] {
  return game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
}

/** Moves the game clock forward (tick() clamps real frame deltas). */
function wait(game: Game, ms: number): void {
  game.state.clock.elapsed += ms;
}

function growAndHarvest(game: Game, field: PlacedObject<FieldState>, crop = 'wheat'): void {
  expect(plant(game, field, crop).ok).toBe(true);
  wait(game, getCrop(crop)!.growMs);
  expect(harvest(game, field)).not.toBeNull();
}

function placePen(game: Game, type: 'coop' | 'pasture'): PlacedObject<PenState> {
  const r = game.place(type, free.x, free.y);
  if (!r.ok) throw new Error(`could not place ${type}: ${r.reason}`);
  return r.object as unknown as PlacedObject<PenState>;
}

function goalIds(game: Game): string[] {
  return game.progression.goals().map((g) => g.def.id);
}

describe('levels', () => {
  it('a new game starts at level 1 with 0 XP and the first three goals', () => {
    const game = new Game(bareMap(createNewGame()));
    expect(game.level).toBe(1);
    expect(game.progression.xp).toBe(0);
    expect(goalIds(game)).toEqual(GOALS.slice(0, ACTIVE_GOALS).map((g) => g.id));
    expect(game.snapshot()).toMatchObject({ level: 1, xp: 0, xpToNext: LEVEL_XP[1] });
  });

  it('the curve rises and maps XP to levels', () => {
    for (let i = 1; i < LEVEL_XP.length; i++) expect(LEVEL_XP[i]).toBeGreaterThan(LEVEL_XP[i - 1]);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(LEVEL_XP[1] - 1)).toBe(1);
    expect(levelForXp(LEVEL_XP[1])).toBe(2);
    expect(levelForXp(1e9)).toBe(MAX_LEVEL);
    expect(xpForLevel(3)).toBe(LEVEL_XP[2]);
  });

  it('selling goods worth $X gives X XP; spending never lowers it', () => {
    const game = new Game(bareMap(createNewGame()));
    game.addItem('egg', 3);
    const earned = sell(game, 'egg');
    expect(earned).toBeGreaterThan(0);
    expect(game.progression.xp).toBe(earned);
    game.spend(100);
    expect(game.progression.xp).toBe(earned);
  });

  it('money that is not income (refunds, debug cash) gives no XP', () => {
    const game = new Game(bareMap(createNewGame()));
    game.earn(1000);
    game.demolish(fields(game)[0].id);
    expect(game.progression.xp).toBe(0);
  });

  it('reaching a level pays $50 × level and reports what unlocked', () => {
    const game = new Game(bareMap(createNewGame()));
    const ups: { level: number; bonus: number; names: string[] }[] = [];
    game.events.on('levelUp', ({ level, bonus, unlocks }) => ups.push({ level, bonus, names: unlocks.map((u) => u.name) }));
    const money = game.money;
    game.earnIncome(LEVEL_XP[1]);
    expect(game.level).toBe(2);
    expect(game.money).toBe(money + LEVEL_XP[1] + LEVEL_BONUS * 2);
    expect(ups).toEqual([{ level: 2, bonus: 100, names: expect.arrayContaining(['Carrot', 'Bakery']) }]);
  });

  it('a big jump pays every level on the way', () => {
    const game = new Game(bareMap(createNewGame()));
    const money = game.money;
    game.progression.addXp(LEVEL_XP[3]);
    expect(game.level).toBe(4);
    expect(game.money).toBe(money + LEVEL_BONUS * (2 + 3 + 4));
  });

  it('the debug level control moves both ways', () => {
    const game = new Game(bareMap(createNewGame()));
    game.progression.setLevel(3);
    expect(game.level).toBe(3);
    expect(game.progression.xp).toBe(LEVEL_XP[2]);
    game.progression.setLevel(1);
    expect(game.level).toBe(1);
    expect(game.progression.xp).toBe(0);
  });
});

describe('unlocks', () => {
  it('every crop, animal and building has an unlock level within the curve', () => {
    for (const c of CROP_LIST) expect(c.unlockLevel).toBeGreaterThanOrEqual(1);
    for (const a of Object.values(ANIMALS)) expect(a.unlockLevel).toBeGreaterThanOrEqual(1);
    for (const b of listBuildables()) {
      expect(b.unlockLevel, b.id).toBeGreaterThanOrEqual(1);
      expect(b.unlockLevel, b.id).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });

  it("level 1 offers only the field, wheat, chickens and their coop, storage, the cottage and the woodcutter's lodge", () => {
    expect(CROP_LIST.filter((c) => c.unlockLevel === 1).map((c) => c.id)).toEqual(['wheat']);
    expect(Object.values(ANIMALS).filter((a) => a.unlockLevel === 1).map((a) => a.id)).toEqual(['chicken']);
    expect(listBuildMenu().filter((b) => b.unlockLevel === 1).map((b) => b.id).sort()).toEqual(['coop', 'cottage', 'field', 'granary', 'path', 'storehouse', 'woodcutter']);
  });

  it('every animal unlocks no earlier than its pen', () => {
    for (const a of Object.values(ANIMALS)) expect(a.unlockLevel).toBeGreaterThanOrEqual(PENS[a.pen].unlockLevel);
  });

  it('no recipe needs an input that unlocks after its building', () => {
    for (const p of Object.values(PROCESSORS)) {
      for (const recipe of p.recipes) {
        for (const [item] of inputsOf(recipe)) {
          expect(itemUnlockLevel(item), `${p.id}/${recipe.id} needs ${item}`).toBeLessThanOrEqual(p.unlockLevel);
        }
      }
    }
  });

  it('the recipe check catches a recipe whose input unlocks later', () => {
    // Wool comes from sheep (level 5); a level-3 dairy recipe using it must fail the rule above.
    expect(itemUnlockLevel('wool')).toBeGreaterThan(PROCESSORS.dairy.unlockLevel);
  });

  it('the logic refuses locked buildings, crops and animals', () => {
    const game = new Game(stockMaterials(bareMap(createNewGame())));
    game.earn(10_000);
    const money = game.money;
    expect(game.place('pasture', free.x, free.y)).toEqual({ ok: false, reason: 'level' });
    expect(game.place('dairy', free.x, free.y)).toEqual({ ok: false, reason: 'level' });
    expect(plant(game, fields(game)[0], 'carrot')).toEqual({ ok: false, reason: 'level' });
    const coop = game.place('coop', free.x, free.y);
    expect(coop.ok).toBe(true);
    expect(game.money).toBe(money - PENS.coop.cost);
  });

  it('newly unlocked content can be used straight away', () => {
    const game = new Game(stockMaterials(bareMap(createNewGame())));
    game.earn(10_000);
    game.progression.setLevel(3);
    expect(plant(game, fields(game)[0], 'carrot').ok).toBe(true);
    const pen = placePen(game, 'pasture');
    expect(buyAnimal(game, pen, 'cow').ok).toBe(true);
    expect(buyAnimal(game, pen, 'sheep')).toEqual({ ok: false, reason: 'level' });
  });

  it('things already on the farm keep working at a lower level', () => {
    const state = bareMap(createNewGame());
    const pen = addStartingObject(state, 'pasture', free.x, free.y) as PlacedObject<PenState>;
    pen.state.animals.push({ kind: 'cow', timer: null });
    const game = new Game(state);
    expect(game.level).toBe(1);
    game.addItem('feed', 2);
    expect(feedAll(game, pen)).toBe(1);
    wait(game, ANIMALS.cow.cycleMs);
    expect(collectAnimals(game, pen)).toEqual({ milk: 1 });
  });

  it('lists what each level unlocks', () => {
    expect(unlocksAt(3).map((u) => u.name).sort()).toEqual(['Cow', 'Dairy', 'Iron at the Market', 'Kennel', 'Pasture', 'Potato']);
    expect(unlocksAt(4).map((u) => u.name)).toEqual(expect.arrayContaining(['Corn', 'Barley', 'Feed Mill']));
    expect(unlocksAt(5).map((u) => u.name).sort()).toEqual(['Loom', 'Sheep']);
    // The later levels unlock crops: flax and the winter cabbage at 6, pumpkin at 7.
    expect(unlocksAt(6)).toEqual([
      { icon: '🪻', name: 'Flax' },
      { icon: '🥬', name: 'Cabbage' },
    ]);
    expect(unlocksAt(7)).toEqual([{ icon: '🎃', name: 'Pumpkin' }]);
  });

  it('each new crop unlocks at its level, and so does its item', () => {
    const levels = { potato: 3, barley: 4, flax: 6, cabbage: 6, pumpkin: 7 } as const;
    for (const [id, level] of Object.entries(levels)) {
      expect(CROPS[id as keyof typeof CROPS].unlockLevel, id).toBe(level);
      expect(itemUnlockLevel(id), id).toBe(level);
    }
  });
});

describe('goals', () => {
  it('the first goals teach the loop: build a field, harvest 20 wheat, build a granary', () => {
    const game = new Game(bareMap(createNewGame()));
    expect(game.progression.claimable()).toBe(0);
    expect(game.place(FIELD, free.x, free.y).ok).toBe(true);
    for (const f of fields(game).slice(0, 2)) growAndHarvest(game, f);
    expect(sell(game, 'wheat', 20)).toBeGreaterThan(0);
    expect(game.progression.goals().map((g) => [g.def.id, g.progress, g.complete])).toEqual([
      ['first-field', 1, true],
      ['harvest-wheat', 20, true],
      ['build-granary', 0, false],
    ]);
    expect(game.progression.claimable()).toBe(2);
    expect(game.snapshot().goals.map((g) => `${g.progress}/${g.target}`)).toEqual(['1/1', '20/20', '0/1']);
  });

  it('claim pays money and XP and fills the slot with the next goal', () => {
    const game = new Game(bareMap(createNewGame()));
    game.place(FIELD, free.x, free.y);
    const money = game.money;
    const xpBefore = game.progression.xp;
    const def = game.progression.claim('first-field');
    expect(def?.id).toBe('first-field');
    expect(game.money).toBe(money + GOALS[0].reward.money);
    expect(game.progression.xp).toBe(xpBefore + GOALS[0].reward.xp);
    expect(goalIds(game)).toEqual([GOALS[3].id, GOALS[1].id, GOALS[2].id]);
  });

  it('cannot claim an unfinished goal', () => {
    const game = new Game(bareMap(createNewGame()));
    expect(game.progression.claim('harvest-wheat')).toBeNull();
    expect(game.progression.claim('nope')).toBeNull();
  });

  it('count goals count only from when they became active', () => {
    const game = new Game(stockMaterials(bareMap(createNewGame())));
    // Collect eggs before the egg goal is active: no credit.
    const pen = placePen(game, 'coop');
    game.earn(1000);
    buyAnimal(game, pen, 'chicken');
    game.addItem('feed', 1);
    feedAll(game, pen);
    wait(game, ANIMALS.chicken.cycleMs);
    collectAnimals(game, pen);
    const data = getSlice<ProgressionState>(game.state, PROGRESSION);
    data.goals = [{ id: 'collect-eggs', progress: 0 }];
    expect(game.progression.goals()[0].progress).toBe(0);
    game.addItem('feed', 1);
    feedAll(game, pen);
    wait(game, ANIMALS.chicken.cycleMs);
    collectAnimals(game, pen);
    expect(game.progression.goals()[0].progress).toBe(1);
  });

  it('state goals read the farm and stay finished once reached', () => {
    const game = new Game(stockMaterials(bareMap(createNewGame())));
    game.earn(10_000);
    const data = getSlice<ProgressionState>(game.state, PROGRESSION);
    data.goals = [{ id: 'own-chickens', progress: 0 }];
    const pen = placePen(game, 'coop');
    buyAnimal(game, pen, 'chicken');
    buyAnimal(game, pen, 'chicken');
    expect(game.progression.goals()[0].progress).toBe(2);
    buyAnimal(game, pen, 'chicken');
    expect(game.progression.goals()[0].complete).toBe(true);
    game.demolish(pen.id);
    expect(game.progression.goals()[0].complete).toBe(true);
  });

  it('own-parcels and reach-level goals follow land and level', () => {
    const game = new Game(bareMap(createNewGame()));
    game.earn(10_000);
    const data = getSlice<ProgressionState>(game.state, PROGRESSION);
    data.goals = [
      { id: 'buy-land', progress: 0 },
      { id: 'reach-3', progress: 0 },
    ];
    buyParcel(game, FARM_PARCELS, START_LAND, parcelsForSale(game.state.land, FARM_PARCELS)[0]);
    game.progression.setLevel(3);
    expect(game.progression.goals().map((g) => g.complete)).toEqual([true, true]);
  });

  it('sales and earnings count for sell and earn goals', () => {
    const game = new Game(bareMap(createNewGame()));
    const data = getSlice<ProgressionState>(game.state, PROGRESSION);
    data.goals = [{ id: 'earn-1000', progress: 0 }];
    game.addItem('cloth', 20);
    const earned = sell(game, 'cloth');
    expect(game.progression.goals()[0].progress).toBe(Math.min(1000, earned));
  });

  it('the panel runs out when every goal is claimed', () => {
    const game = new Game(bareMap(createNewGame()));
    for (let i = 0; i < GOALS.length; i++) {
      game.progression.completeAll();
      for (const g of game.progression.goals()) game.progression.claim(g.def.id);
    }
    expect(game.progression.goals()).toEqual([]);
    expect(game.progression.allDone).toBe(true);
  });

  it('new goals go at the end, after the goals saves already know by index: the crop goals, then the hazard goals', () => {
    const cloth = GOALS.findIndex((g) => g.id === 'weave-cloth');
    expect(GOALS.slice(cloth + 1).map((g) => g.id)).toEqual([
      'harvest-potatoes',
      'winter-cabbage',
      'grow-pumpkins',
      'build-well',
      'guard-coop',
    ]);
  });

  it('harvest cabbage in winter counts only a winter harvest', () => {
    const game = new Game(maxLevelState());
    const data = getSlice<ProgressionState>(game.state, PROGRESSION);
    data.goals = [
      { id: 'winter-cabbage', progress: 0 },
      { id: 'harvest-potatoes', progress: 0 },
    ];
    game.state.clock.elapsed = 2 * SEASON_MS + 1000; // autumn
    game.activity.emit('harvested', { item: 'cabbage', qty: 8 });
    expect(game.progression.goals()[0].progress).toBe(0);
    game.state.clock.elapsed = 3 * SEASON_MS + 1000; // winter
    game.activity.emit('harvested', { item: 'cabbage', qty: 8 });
    expect(game.progression.goals()[0].complete).toBe(true);
    // A harvest goal without a season counts in any season.
    game.activity.emit('harvested', { item: 'potato', qty: 14 });
    expect(game.progression.goals()[1].progress).toBe(14);
  });

  it('has about 15 goals with unique ids', () => {
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
    expect(GOALS.length).toBeGreaterThanOrEqual(15);
  });
});

describe('save', () => {
  it('keeps level, XP and goal progress across a reload', () => {
    const game = new Game(bareMap(createNewGame()));
    game.place(FIELD, free.x, free.y);
    game.earnIncome(150);
    growAndHarvest(game, fields(game)[0]);
    const loaded = new Game(deserialize(serialize(game.state)));
    expect(loaded.level).toBe(game.level);
    expect(loaded.progression.xp).toBe(150);
    expect(loaded.progression.goals().map((g) => [g.def.id, g.progress])).toEqual([
      ['first-field', 1],
      ['harvest-wheat', 12], // a starting field, on rich soil
      ['build-granary', 0],
    ]);
  });

  it('repairs junk progression data', () => {
    const state = bareMap(createNewGame());
    state.ext[PROGRESSION] = { xp: -5, goals: [{ id: 'nope' }, { id: 'sell-wheat', progress: 'x' }, 7], nextGoal: 99 };
    const game = new Game(deserialize(serialize(state)));
    expect(game.progression.xp).toBe(0);
    expect(game.progression.goals().map((g) => [g.def.id, g.progress])).toEqual([['sell-wheat', 0]]);
  });

  function v1Save(objects: unknown[]): string {
    const state = createNewGame() as unknown as Record<string, unknown>;
    const ext = { ...(state.ext as Record<string, unknown>) };
    delete ext[PROGRESSION];
    return JSON.stringify({ version: 1, savedAt: 0, state: { ...state, money: 1234, ext, objects } });
  }

  it('an old save with only level-1 things starts at level 1 with the first goals', () => {
    const game = new Game(deserialize(v1Save([{ id: 'o1', type: 'field', x: 12, y: 9, state: { crop: 'wheat', timer: null } }])));
    expect(game.level).toBe(1);
    expect(game.money).toBe(1234);
    expect(goalIds(game)).toEqual(GOALS.slice(0, 3).map((g) => g.id));
  });

  it('an old save starts at the lowest level that unlocks everything on it', () => {
    const cases: [unknown[], number][] = [
      [[{ id: 'o1', type: 'field', x: 12, y: 9, state: { crop: 'carrot', timer: null } }], 2],
      [[{ id: 'o1', type: 'dairy', x: 12, y: 9, state: {} }], 3],
      [[{ id: 'o1', type: 'pasture', x: 12, y: 9, state: { animals: [{ kind: 'sheep', timer: null }] } }], 5],
      [[{ id: 'o1', type: 'feed-mill', x: 12, y: 9, state: {} }], 4],
    ];
    for (const [objects, level] of cases) {
      const game = new Game(deserialize(v1Save(objects)));
      expect(game.level, JSON.stringify(objects)).toBe(level);
      expect(game.state.objects.filter((o) => o.type !== 'farmhouse' && o.type !== 'path')).toHaveLength(1);
      expect(requiredLevel(objects)).toBe(level);
    }
  });
});
