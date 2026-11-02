import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBuildable } from '../data/buildables';
import { APPROVAL, ARRIVAL_DELAY_DAYS, ARRIVE_APPROVAL, COTTAGE, FOODS, LEAVE_APPROVAL, MEAL_PER_FAMILY } from '../data/families';
import { FIELD } from '../data/crops';
import { MAX_FARMERS } from '../data/workers';
import { DAY_MS, START_LAYOUT } from './constants';
import { addFamily, approvalOf, familiesOf, homesOf, mealFrom, YEAR_MS, type DayNeeds } from './families';
import { Game } from './game';
import { setOwned } from './land';
import { catchUp } from './offline';
import { connectToFarmhouse } from './roads';
import { parseSave, serialize } from './save';
import { SEASON_MS } from './seasons';
import { bareMap, maxLevelState, noCamp, stockMaterials } from './test-utils';
import type { GameState } from './types';
import { addFarmer, assignFarmer, workersOf } from './workers';

/** Where a winter begins: the start of the farm's first winter. */
const WINTER = 3 * SEASON_MS;
/** A free spot near the farmhouse with room for a row of cottages. */
const X = START_LAYOUT.x - 1;
const Y = START_LAYOUT.y + 6;

/** A farm owning the whole map with plenty of money (and, at `max`, every building and the loom unlocked). */
function farm({ max = true } = {}): Game {
  const game = new Game(max ? maxLevelState() : bareMap(stockMaterials(new Game().state)));
  game.earn(1_000_000);
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  return game;
}

/** Finished cottages (no farmer needed). */
function cottages(game: Game, n: number): void {
  for (let i = 0; i < n; i++) {
    const r = game.place(COTTAGE, X + 2 * i, Y);
    if (!r.ok) throw new Error(`could not place a cottage: ${r.reason}`);
  }
}

/** Puts `n` of an item in store, room or not (the farms here have no granary). */
function stock(game: Game, id: string, n: number): void {
  game.state.inventory[id] = (game.state.inventory[id] ?? 0) + n;
}

/** Moves the clock to game time `t` without running anything, before the families have counted a day. */
function startAt(game: Game, t: number): void {
  game.state.clock.elapsed = t;
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

describe('families: rules', () => {
  it('a meal is spread across the foods in stock, one kind after another', () => {
    const stock: Record<string, number> = { wheat: 10, carrot: 1, egg: 5, feed: 50, wool: 9, cloth: 9 };
    expect(mealFrom((id) => stock[id] ?? 0, 3)).toEqual({ wheat: 3, carrot: 1, egg: 2 });
    expect(mealFrom((id) => stock[id] ?? 0, 1)).toEqual({ wheat: 1, carrot: 1 });
    // Never feed, wool or cloth; never more than there is.
    expect(mealFrom((id) => ({ feed: 9, wool: 9, cloth: 9, wheat: 1 })[id] ?? 0, 2)).toEqual({ wheat: 1 });
    expect(mealFrom(() => 0, 4)).toEqual({});
    expect(FOODS).not.toContain('feed');
  });

  it('potato, cabbage and pumpkin are food; barley and flax are not (they are for the mill and the market)', () => {
    expect(FOODS).toEqual(expect.arrayContaining(['potato', 'cabbage', 'pumpkin']));
    expect(FOODS).not.toContain('barley');
    expect(FOODS).not.toContain('flax');
    // Each new food is another kind on the table, so it lifts the variety approval.
    const stock: Record<string, number> = { potato: 9, cabbage: 9, pumpkin: 9, barley: 9, flax: 9 };
    expect(mealFrom((id) => stock[id] ?? 0, 3)).toEqual({ potato: 2, cabbage: 2, pumpkin: 2 });
  });

  it('approval: variety lifts it, starving or freezing sinks it below the leaving line', () => {
    const wheat = approvalOf(day({ families: 2, meal: 4, eaten: 4, variety: 1, ate: { wheat: 4 } })).approval;
    const three = approvalOf(day({ families: 2, meal: 4, eaten: 4, variety: 3, ate: { wheat: 2, carrot: 1, egg: 1 } })).approval;
    expect(wheat).toBe(50);
    expect(three).toBe(60);
    expect(approvalOf(day({ variety: 2 })).approval).toBeGreaterThan(ARRIVE_APPROVAL);
    // Variety is capped.
    expect(approvalOf(day({ families: 4, meal: 8, eaten: 8, variety: 8 })).approval).toBe(70);

    expect(approvalOf(day({ eaten: 0, variety: 0 })).approval).toBeLessThan(LEAVE_APPROVAL);
    // Freezing beats the best of everything else.
    const freezing = day({ families: 4, meal: 8, eaten: 8, variety: 8, clothed: 4, firewood: 0, firewoodNeeded: 4 });
    expect(approvalOf(freezing).approval).toBeLessThan(LEAVE_APPROVAL);
    // Starving too, even warm and clothed.
    expect(approvalOf(day({ eaten: 0, variety: 0, clothed: 1, firewood: 1, firewoodNeeded: 1 })).approval).toBeLessThan(LEAVE_APPROVAL);
  });

  it('the breakdown adds up to the approval and names each part', () => {
    const { approval, breakdown } = approvalOf(day({ families: 2, meal: 4, eaten: 3, variety: 2, clothed: 1, firewood: 2, firewoodNeeded: 2 }));
    expect(breakdown.map((p) => [p.id, p.points])).toEqual([
      ['base', 50],
      ['food', -20],
      ['variety', 5],
      ['clothes', 5],
      ['firewood', 10],
    ]);
    expect(approval).toBe(50);
  });

  it('ale: +10 when every family had some, a share when some did, and no part before the brewery', () => {
    const part = (over: Partial<DayNeeds>) => approvalOf(day(over)).breakdown.find((p) => p.id === 'ale');
    expect(part({ families: 3, ale: 3 })).toEqual({ id: 'ale', label: 'Ale for every family', points: APPROVAL.ale });
    expect(part({ families: 4, ale: 2 })).toEqual({ id: 'ale', label: '2 of 4 families had ale', points: 5 });
    expect(part({ families: 2, ale: 0 })).toMatchObject({ points: 0 });
    expect(part({ ale: null })).toBeUndefined();
    // Saves from before the brewery have no ale on their last day.
    expect(part({})).toBeUndefined();
  });

  it("clothes: the tailor's clothes are worth more than cloth", () => {
    const part = (over: Partial<DayNeeds>) => approvalOf(day(over)).breakdown.find((p) => p.id === 'clothes');
    expect(part({ families: 2, clothed: 2, dressed: 0 })).toEqual({ id: 'clothes', label: '2 of 2 families clothed', points: APPROVAL.clothed });
    expect(part({ families: 2, clothed: 2, dressed: 2 })).toEqual({ id: 'clothes', label: '2 of 2 families clothed (2 in clothes)', points: APPROVAL.dressed });
    // One in clothes, one in cloth: (15 + 10) / 2.
    expect(part({ families: 2, clothed: 2, dressed: 1 })).toMatchObject({ points: 13 });
    expect(APPROVAL.dressed).toBeGreaterThan(APPROVAL.clothed);
  });
});

describe('families on the farm', () => {
  beforeEach(() => void vi.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => vi.restoreAllMocks());

  it('a new game has one family in the farmhouse and no free home', () => {
    const game = new Game();
    expect(homesOf(game.state)).toBe(1);
    expect(workersOf(game.state).farmers).toBe(1);
    expect(familiesOf(game.state)).toMatchObject({ approval: 50, nextArrivalAt: null, lastDay: null });
    expect(getBuildable(COTTAGE)).toMatchObject({ category: 'homes', unlockLevel: 1, footprint: { w: 2, h: 2 } });
  });

  it('each day the families eat 2 food each from the granary, and approval follows what they ate', () => {
    const game = farm();
    addFarmer(game); // a second family (more farmers than homes, as in an old save)
    stock(game, 'wheat', 20);
    game.advance(DAY_MS);
    expect(game.count('wheat')).toBe(20 - 2 * MEAL_PER_FAMILY);
    expect(familiesOf(game.state).lastDay).toMatchObject({ ate: { wheat: 4 }, variety: 1, families: 2 });
    const wheatOnly = familiesOf(game.state).approval;

    stock(game, 'carrot', 5);
    stock(game, 'egg', 5);
    game.advance(DAY_MS);
    expect(familiesOf(game.state).lastDay).toMatchObject({ ate: { wheat: 2, carrot: 1, egg: 1 }, variety: 3 });
    expect(familiesOf(game.state).approval).toBeGreaterThan(wheatOnly);
    expect(game.count('wheat') + game.count('carrot') + game.count('egg')).toBe(16 + 10 - 4);
  });

  it('a built cottage brings a new family half a day later when approval is high enough; at most one a day', () => {
    const game = farm();
    stock(game, 'wheat', 50);
    stock(game, 'carrot', 50);
    game.advance(DAY_MS); // approval 55 after the first meal
    expect(familiesOf(game.state).approval).toBeGreaterThanOrEqual(ARRIVE_APPROVAL);
    cottages(game, 2);
    game.advance(1);
    const due = familiesOf(game.state).nextArrivalAt!;
    expect(due).toBe(DAY_MS + ARRIVAL_DELAY_DAYS * DAY_MS); // from the step at the moment the cottages stood

    game.advance(due - game.now - 1);
    expect(workersOf(game.state).farmers).toBe(1);
    const arrived: number[] = [];
    game.activity.on('familyArrived', () => arrived.push(game.now));
    game.advance(1);
    expect(workersOf(game.state).farmers).toBe(2);
    expect(workersOf(game.state).workplaces[1]).toBeNull();
    // The second cottage fills a whole day after the first.
    expect(familiesOf(game.state).nextArrivalAt).toBe(due + DAY_MS);
    game.advance(DAY_MS);
    expect(arrived).toEqual([due, due + DAY_MS]);
    expect(workersOf(game.state).farmers).toBe(3);
    expect(familiesOf(game.state).nextArrivalAt).toBeNull();
  });

  it('a cottage built as a construction site counts once a farmer has built it', () => {
    const game = farm();
    stock(game, 'wheat', 50);
    const r = game.place(COTTAGE, X, Y, { site: true });
    if (!r.ok) throw new Error(r.reason);
    expect(connectToFarmhouse(game.state, { x: X, y: Y, w: 2, h: 2 })).toBeTruthy();
    expect(homesOf(game.state)).toBe(1);
    let builtAt = -1;
    game.activity.on('built', () => (builtAt = game.now));
    game.advance(DAY_MS / 4);
    expect(builtAt).toBeGreaterThan(0);
    expect(homesOf(game.state)).toBe(2);
    expect(familiesOf(game.state).nextArrivalAt).toBe(builtAt + ARRIVAL_DELAY_DAYS * DAY_MS);
    game.advance(DAY_MS);
    expect(workersOf(game.state).farmers).toBe(2);
  });

  it('no family moves in while approval is below 50%; one comes once it recovers', () => {
    const game = farm();
    noCamp(game.state);
    game.advance(DAY_MS); // nothing to eat: approval 0
    expect(familiesOf(game.state).approval).toBeLessThan(ARRIVE_APPROVAL);
    cottages(game, 1);
    game.advance(DAY_MS - 1);
    expect(workersOf(game.state).farmers).toBe(1);
    stock(game, 'wheat', 10);
    game.advance(1); // the next day: fed, approval back to 50
    expect(familiesOf(game.state).approval).toBe(50);
    expect(workersOf(game.state).farmers).toBe(2);
  });

  it("a new farm's families eat the camp's food, so nobody starves before the first harvest; with none left they go hungry", () => {
    const game = farm({ max: false });
    cottages(game, 1);
    game.advance(2 * DAY_MS);
    expect(workersOf(game.state).farmers).toBe(2); // arrived half a day in, on the starting approval
    // Bread and carrots from the camp: two kinds of food, no hunger.
    expect(familiesOf(game.state).approval).toBe(APPROVAL.base + APPROVAL.perExtraFood);
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'food')).toBeUndefined();
    for (const id of ['bread', 'carrot']) delete game.state.inventory[id];
    game.advance(DAY_MS); // the granary is empty: there is no grace any more
    expect(familiesOf(game.state).approval).toBeLessThan(LEAVE_APPROVAL);
  });

  it('while there are more farmers than homes no family arrives, and nobody leaves for lack of a home', () => {
    const game = farm();
    for (let i = 0; i < 4; i++) addFarmer(game);
    cottages(game, 2);
    stock(game, 'wheat', 200);
    game.advance(5 * DAY_MS);
    expect(workersOf(game.state).farmers).toBe(5);
    expect(familiesOf(game.state).nextArrivalAt).toBeNull();
    expect(addFamily(game)).toBe(false);
  });

  it('in winter each occupied home burns 1 wood a day; cold homes sink approval and a family leaves after a whole day', () => {
    const game = farm({ max: false });
    startAt(game, WINTER - 1);
    cottages(game, 2);
    addFamily(game);
    addFamily(game);
    const w = workersOf(game.state);
    const field = game.objectsOfType(FIELD)[0];
    expect(assignFarmer(game, field.id, 2).ok).toBe(true);
    game.state.inventory.wood = 4; // one day of firewood for three homes, and one stick over
    stock(game, 'wheat', 100);
    stock(game, 'carrot', 100);
    const left: (string | null)[] = [];
    game.activity.on('familyLeft', ({ workplace }) => left.push(workplace));

    game.advance(1); // winter day 1
    expect(game.count('wood')).toBe(1);
    expect(familiesOf(game.state).lastDay).toMatchObject({ firewood: 3 });
    expect(familiesOf(game.state).approval).toBeGreaterThanOrEqual(ARRIVE_APPROVAL);

    game.advance(DAY_MS); // winter day 2: one stick for three homes
    expect(game.count('wood')).toBe(0);
    expect(familiesOf(game.state).approval).toBeLessThan(LEAVE_APPROVAL);
    expect(w.farmers).toBe(3);

    game.advance(DAY_MS); // a whole day below the line: the last family leaves, their field is free
    expect(left).toEqual([field.id]);
    expect(workersOf(game.state).farmers).toBe(2);
    expect(workersOf(game.state).workplaces).toEqual([null, null]);
    game.advance(DAY_MS);
    expect(workersOf(game.state).farmers).toBe(1);
    // The last family never leaves, however unhappy (and no new one comes to a farm like that).
    game.state.inventory = {};
    game.advance(4 * DAY_MS);
    expect(workersOf(game.state).farmers).toBe(1);
    expect(left).toHaveLength(2);
  });

  it('once the loom is unlocked each family takes 1 cloth at the start of winter, and is clothed all year', () => {
    const game = farm();
    cottages(game, 2);
    addFamily(game);
    addFamily(game);
    stock(game, 'wheat', 200);
    stock(game, 'cloth', 2);
    game.state.inventory.wood = 1000;
    game.advance(WINTER - 1 - game.now);
    expect(game.count('cloth')).toBe(2);
    game.advance(1);
    expect(game.count('cloth')).toBe(0);
    expect(familiesOf(game.state).lastDay).toMatchObject({ clothed: 2 });
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'clothes')).toMatchObject({ points: 7 });
    // Clothed for the rest of the year; no more cloth is taken until next winter.
    stock(game, 'cloth', 5);
    game.advance(2 * SEASON_MS);
    expect(game.count('cloth')).toBe(5);
    expect(familiesOf(game.state).lastDay).toMatchObject({ clothed: 2 });
    game.advance(WINTER + YEAR_MS - game.now);
    expect(game.count('cloth')).toBe(2);
    expect(familiesOf(game.state).lastDay).toMatchObject({ clothed: 3 });
  });

  it('at the start of winter families take clothes while there are any, and cloth for the rest', () => {
    const game = farm();
    cottages(game, 2);
    addFamily(game);
    addFamily(game);
    stock(game, 'wheat', 200);
    stock(game, 'clothes', 2);
    stock(game, 'cloth', 5);
    game.state.inventory.wood = 1000;
    game.advance(WINTER - game.now);
    // Three families: two take clothes, the third cloth.
    expect(game.count('clothes')).toBe(0);
    expect(game.count('cloth')).toBe(4);
    expect(familiesOf(game.state).lastDay).toMatchObject({ clothed: 3, dressed: 2 });
    // (15 + 15 + 10) / 3
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'clothes')).toMatchObject({ label: '3 of 3 families clothed (2 in clothes)', points: 13 });
  });

  it('with clothes for everyone no cloth is taken; with none, families fall back on cloth as before', () => {
    const game = farm();
    stock(game, 'wheat', 200);
    stock(game, 'clothes', 3);
    stock(game, 'cloth', 3);
    game.state.inventory.wood = 1000;
    game.advance(WINTER - game.now);
    expect([game.count('clothes'), game.count('cloth')]).toEqual([2, 3]);
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'clothes')).toMatchObject({ points: APPROVAL.dressed });

    game.state.inventory.clothes = 0;
    game.advance(WINTER + YEAR_MS - game.now);
    expect(game.count('cloth')).toBe(2);
    expect(familiesOf(game.state).lastDay).toMatchObject({ clothed: 1, dressed: 0 });
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'clothes')).toMatchObject({ points: APPROVAL.clothed });
  });

  it('once the brewery is unlocked families drink 1 ale per 2 families a day, while there is any', () => {
    const game = farm();
    cottages(game, 2);
    addFamily(game);
    addFamily(game);
    stock(game, 'wheat', 200);
    stock(game, 'ale', 3);
    game.advance(DAY_MS);
    // Three families: two ale, one shared and one alone.
    expect(game.count('ale')).toBe(1);
    expect(familiesOf(game.state).lastDay).toMatchObject({ ale: 3, aleDrunk: 2 });
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'ale')).toMatchObject({ points: APPROVAL.ale });
    // Short: the last ale goes to two of the three.
    game.advance(DAY_MS);
    expect(game.count('ale')).toBe(0);
    expect(familiesOf(game.state).lastDay).toMatchObject({ ale: 2, aleDrunk: 1 });
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'ale')).toMatchObject({ label: '2 of 3 families had ale', points: 7 });
    // None left: the part stays, at nothing.
    game.advance(DAY_MS);
    expect(familiesOf(game.state).lastDay).toMatchObject({ ale: 0, aleDrunk: 0 });
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'ale')).toMatchObject({ points: 0 });
  });

  it('before the brewery is unlocked ale is not drunk and approval has no ale part', () => {
    const game = farm({ max: false });
    stock(game, 'wheat', 100);
    stock(game, 'ale', 3);
    game.advance(2 * DAY_MS);
    expect(game.count('ale')).toBe(3);
    expect(familiesOf(game.state).lastDay?.ale).toBeNull();
    expect(familiesOf(game.state).breakdown.some((p) => p.id === 'ale')).toBe(false);
  });

  it('before the loom is unlocked cloth is no need: none is taken and approval has no clothes part', () => {
    const game = farm({ max: false });
    stock(game, 'wheat', 100);
    stock(game, 'cloth', 3);
    game.state.inventory.wood = 100;
    game.advance(WINTER + 1);
    expect(game.count('cloth')).toBe(3);
    expect(familiesOf(game.state).lastDay?.clothed).toBeNull();
    expect(familiesOf(game.state).breakdown.some((p) => p.id === 'clothes')).toBe(false);
  });

  it('never more families than MAX_FARMERS, whatever the homes', () => {
    const game = farm();
    for (let i = 0; i < MAX_FARMERS + 2; i++) game.place(COTTAGE, (i % 12) * 2 + 2, Math.floor(i / 12) * 2 + 2);
    while (addFamily(game));
    expect(workersOf(game.state).farmers).toBe(MAX_FARMERS);
    stock(game, 'wheat', 200);
    game.advance(3 * DAY_MS);
    expect(workersOf(game.state).farmers).toBe(MAX_FARMERS);
    expect(familiesOf(game.state).nextArrivalAt).toBeNull();
  });
});

describe('families on game time', () => {
  beforeEach(() => void vi.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => vi.restoreAllMocks());

  /** A farm two days before winter with cottages, a little food and wood: families come, eat, freeze and leave. */
  function setup(): Game {
    const game = farm({ max: false });
    startAt(game, WINTER - 2 * DAY_MS + 1000);
    cottages(game, 3);
    stock(game, 'wheat', 12);
    stock(game, 'carrot', 6);
    stock(game, 'egg', 4);
    game.state.inventory.wood = 3;
    return game;
  }

  function snapshot(state: GameState) {
    return { families: structuredClone(state.ext.families), workers: structuredClone(state.ext.workers), inventory: { ...state.inventory }, clock: state.clock.elapsed };
  }

  it('×60 for a game week and the same span of offline catch-up give identical families, approval and stock', () => {
    const live = setup();
    const away = setup();
    const week = 7 * DAY_MS;
    const to = live.now + week;
    live.setSpeed(60);
    while (live.now < to) live.tick(Math.min(250, (to - live.now) / 60));
    catchUp(away, week);

    expect(snapshot(live.state)).toEqual(snapshot(away.state));
    // Something did happen on the way: families arrived and at least one left.
    expect(workersOf(away.state).farmers).toBeGreaterThanOrEqual(1);
    expect(familiesOf(away.state).settledDay).toBe(Math.floor(to / DAY_MS));
  });

  it('offline catch-up reports families who arrived and left', () => {
    const game = setup();
    const r = catchUp(game, 7 * DAY_MS);
    expect(r.families.arrived).toBeGreaterThan(0);
    expect(r.families.left).toBeGreaterThan(0);
  });
});

describe('families in saves', () => {
  it('a version-9 save keeps all its farmers, housed or not, and skips goals it is past', () => {
    const game = new Game();
    for (let i = 0; i < 4; i++) addFarmer(game);
    const raw = JSON.parse(serialize(game.state));
    raw.version = 9;
    delete raw.state.ext.families;
    raw.state.ext.progression = { xp: 0, goals: [{ id: 'build-coop', progress: 0 }], nextGoal: 13 };
    const loaded = new Game(parseSave(JSON.stringify(raw)).state);
    expect(workersOf(loaded.state).farmers).toBe(5);
    expect(homesOf(loaded.state)).toBe(1);
    expect((loaded.state.ext.progression as { nextGoal: number }).nextGoal).toBe(14);
    stock(loaded, 'wheat', 100);
    loaded.advance(2 * DAY_MS);
    expect(workersOf(loaded.state).farmers).toBe(5);
    expect(familiesOf(loaded.state).nextArrivalAt).toBeNull();
    expect(familiesOf(loaded.state).lastDay).toMatchObject({ families: 5, eaten: 10 });
  });

  it('families survive save and load', () => {
    const game = farm();
    cottages(game, 1);
    stock(game, 'wheat', 10);
    game.advance(DAY_MS + 1);
    const loaded = new Game(parseSave(serialize(game.state)).state);
    expect(familiesOf(loaded.state)).toEqual(familiesOf(game.state));
  });
});
