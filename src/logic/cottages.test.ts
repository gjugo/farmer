import { describe, expect, it } from 'vitest';
import { COTTAGE, COTTAGE_DEF } from '../data/families';
import { GARDEN_APPROVAL } from '../data/gardens';
import { SEASON_DAYS } from '../data/seasons';
import { DAY_MS, START_LAYOUT } from './constants';
import { checkCottageUpgrade, cottageChecklist, upgradeCottage, winterFirewood } from './cottages';
import { addFamily, familiesOf, type DayNeeds } from './families';
import { Game, materialsRefundOf, refundOf } from './game';
import { cottageLevel, homeBuildings, homeList, homeRoom } from './homes';
import { harshWinterWood } from './hazards';
import { setOwned } from './land';
import { PROGRESSION, type ProgressionState } from './progression';
import { parseSave, serialize } from './save';
import { SEASON_MS } from './seasons';
import { getSlice } from './slices';
import { bareMap } from './test-utils';
import type { PlacedObject } from './types';
import { xpForLevel } from './unlocks';
import { workersOf } from './workers';

const WINTER = 3 * SEASON_MS;
const X = START_LAYOUT.x - 1;
const Y = START_LAYOUT.y + 6;

/** A farm at `level` owning the whole map, with no money or materials until a test gives them. */
function farm(level = 3): Game {
  const game = new Game(bareMap(new Game().state));
  getSlice<ProgressionState>(game.state, PROGRESSION).xp = xpForLevel(level);
  game.state.money = 0;
  game.state.inventory = {};
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  return game;
}

/** A finished cottage at the i-th spot of a row (placed for free: the money and wood are given and taken back). */
function cottage(game: Game, i = 0): PlacedObject {
  const money = game.state.money;
  const wood = game.state.inventory.wood ?? 0;
  game.state.money += COTTAGE_DEF.cost;
  game.state.inventory.wood = wood + COTTAGE_DEF.materials.wood;
  const r = game.place(COTTAGE, X + 2 * i, Y);
  if (!r.ok) throw new Error(`could not place a cottage: ${r.reason}`);
  game.state.money = money;
  game.state.inventory.wood = wood;
  return r.object;
}

/** Yesterday's meal as the families settled it. */
function ate(game: Game, over: Partial<DayNeeds> = {}): void {
  const families = workersOf(game.state).farmers;
  familiesOf(game.state).lastDay = {
    families,
    ate: { wheat: families, carrot: families },
    eaten: 2 * families,
    meal: 2 * families,
    variety: 2,
    firewood: null,
    firewoodNeeded: families,
    clothed: null,
    ...over,
  };
}

/** Every need met: 2 foods yesterday, a winter's firewood on top of the upgrade's wood, the cost in hand. */
function ready(game: Game): void {
  ate(game);
  game.state.money = 120;
  game.state.inventory.wood = 12 + winterFirewood(workersOf(game.state).farmers);
  game.state.inventory.stone = 8;
}

/** Sets a cottage's level directly. */
function setLevel(obj: PlacedObject, level: number): void {
  obj.state.level = level;
}

describe('cottage levels: data', () => {
  it('level 1 houses one family, level 2 two; level 2 costs $120 + 12 wood + 8 stone from farm level 3 and 2 foods', () => {
    expect(COTTAGE_DEF.levels.map((l) => l.room)).toEqual([1, 2]);
    expect(COTTAGE_DEF.levels[1].upgrade).toEqual({ cost: 120, materials: { wood: 12, stone: 8 }, farmLevel: 3, foods: 2 });
  });

  it('a new cottage is level 1, and a cottage without a level (an old save) reads as level 1', () => {
    const game = farm();
    const c = cottage(game);
    expect(c.state.level).toBe(1);
    expect(cottageLevel({ ...c, state: {} })).toBe(1);
    expect(cottageLevel({ ...c, state: { level: 7 } })).toBe(2);
    expect(cottageLevel({ ...c, state: { level: 'x' } })).toBe(1);
  });
});

describe('cottage upgrade: the checklist', () => {
  it('every line met: the upgrade works, charges the cost and keeps a winter of firewood', () => {
    const game = farm();
    const c = cottage(game);
    addFamily(game);
    ready(game);
    const list = cottageChecklist(game, c);
    expect(list).toMatchObject({ next: 2, ok: true, blocked: null, level: { ok: true }, fuel: { ok: true }, food: { ok: true }, cost: { ok: true } });
    const upgraded: unknown[] = [];
    game.activity.on('upgraded', (e) => upgraded.push(e));
    expect(upgradeCottage(game, c)).toEqual({ ok: true, level: 2 });
    expect(c.state.level).toBe(2);
    expect(game.state.money).toBe(0);
    expect(game.count('stone')).toBe(0);
    expect(game.count('wood')).toBe(winterFirewood(2)); // 2 families × 4 winter days
    expect(upgraded).toEqual([{ type: COTTAGE, level: 2 }]);
  });

  it('below farm level 3: ❌ level, and it blocks', () => {
    const game = farm(2);
    const c = cottage(game);
    ready(game);
    const list = cottageChecklist(game, c);
    expect(list.level).toMatchObject({ ok: false, text: expect.stringMatching(/Farm level 3 \(the farm is level 2\)/) });
    expect([list.fuel.ok, list.food.ok, list.cost.ok]).toEqual([true, true, true]);
    expect(list.ok).toBe(false);
    expect(upgradeCottage(game, c)).toEqual({ ok: false, reason: 'needs' });
    expect(c.state.level).toBe(1);
    expect(game.state.money).toBe(120);
  });

  it('one kind of food yesterday, someone short, or no day yet: ❌ food, and it blocks', () => {
    const game = farm();
    const c = cottage(game);
    ready(game);
    ate(game, { variety: 1, ate: { wheat: 2 } });
    expect(cottageChecklist(game, c)).toMatchObject({ ok: false, food: { ok: false, text: expect.stringMatching(/ate 1 kind/) } });
    ate(game, { eaten: 1 });
    expect(cottageChecklist(game, c)).toMatchObject({ ok: false, food: { ok: false, text: expect.stringMatching(/short yesterday: 1 of 2/) } });
    familiesOf(game.state).lastDay = null;
    expect(cottageChecklist(game, c)).toMatchObject({ ok: false, food: { ok: false } });
    ate(game);
    expect(cottageChecklist(game, c).ok).toBe(true);
  });

  it("too little wood for a winter, counted after the upgrade's own 12 wood: ❌ fuel, and it blocks", () => {
    const game = farm();
    const c = cottage(game);
    addFamily(game);
    ready(game);
    const families = 2;
    expect(winterFirewood(families)).toBe(families * SEASON_DAYS);
    // Enough for a winter, but not once the upgrade has taken its 12.
    game.state.inventory.wood = 12 + winterFirewood(families) - 1;
    const list = cottageChecklist(game, c);
    expect(list.fuel).toMatchObject({ ok: false, text: expect.stringMatching(/after the upgrade's 12/) });
    expect(list.cost.ok).toBe(true);
    expect(list.ok).toBe(false);
    expect(checkCottageUpgrade(game, c)).toEqual({ ok: false, reason: 'needs' });
    game.state.inventory.wood! += 1;
    expect(cottageChecklist(game, c).ok).toBe(true);
  });

  it('short of money or stone: ❌ cost with what is missing, and it blocks', () => {
    const game = farm();
    const c = cottage(game);
    ready(game);
    game.state.money = 100;
    expect(cottageChecklist(game, c)).toMatchObject({ ok: false, cost: { ok: false, text: expect.stringMatching(/\$20 more/) } });
    game.state.money = 120;
    game.state.inventory.stone = 5;
    expect(cottageChecklist(game, c)).toMatchObject({ ok: false, cost: { ok: false, text: expect.stringMatching(/3 more 🪨 Stone/) } });
    expect(cottageChecklist(game, c).fuel.ok).toBe(true);
  });

  it('blocked on a construction site and at level 2', () => {
    const game = farm();
    game.state.money = 1000;
    game.state.inventory.wood = 100;
    const r = game.place(COTTAGE, X, Y, { site: true });
    if (!r.ok) throw new Error(r.reason);
    ready(game);
    game.state.money = 1000;
    expect(cottageChecklist(game, r.object)).toMatchObject({ blocked: 'site', ok: false });
    expect(checkCottageUpgrade(game, r.object)).toEqual({ ok: false, reason: 'site' });
    const c = cottage(game, 2);
    setLevel(c, 2);
    expect(cottageChecklist(game, c)).toMatchObject({ blocked: 'max', ok: false, next: 2 });
    expect(upgradeCottage(game, c)).toEqual({ ok: false, reason: 'max' });
  });

  it('never goes down a level when the needs lapse later', () => {
    const game = farm();
    const c = cottage(game);
    ready(game);
    upgradeCottage(game, c);
    familiesOf(game.state).lastDay = null;
    game.state.inventory = {};
    game.advance(3 * DAY_MS);
    expect(cottageLevel(c)).toBe(2);
  });
});

describe('homes: room and buildings', () => {
  it('room counts families that fit, buildings count the farmhouse and finished cottages', () => {
    const game = farm();
    const a = cottage(game, 0);
    cottage(game, 1);
    expect(homeRoom(game.state)).toBe(3);
    expect(homeBuildings(game.state)).toBe(3);
    setLevel(a, 2);
    expect(homeRoom(game.state)).toBe(4);
    expect(homeBuildings(game.state)).toBe(3);
  });

  it('families fill the farmhouse, then the cottages in build order, each up to its room', () => {
    const game = farm();
    const a = cottage(game, 0);
    const b = cottage(game, 1);
    setLevel(a, 2);
    const fam = (n: number) => homeList(game.state, n).map((h) => [h.type, h.level, h.room, h.families]);
    expect(fam(1)).toEqual([
      ['farmhouse', 1, 1, 1],
      [COTTAGE, 2, 2, 0],
      [COTTAGE, 1, 1, 0],
    ]);
    expect(fam(2).map((h) => h[3])).toEqual([1, 1, 0]);
    expect(fam(3).map((h) => h[3])).toEqual([1, 2, 0]);
    expect(fam(4).map((h) => h[3])).toEqual([1, 2, 1]);
    expect(homeList(game.state, 4).map((h) => h.id).slice(1)).toEqual([a.id, b.id]);
  });

  it('an upgrade adds room: a second family moves in at approval of 50% or more', () => {
    const game = farm();
    const c = cottage(game);
    addFamily(game);
    expect(homeRoom(game.state)).toBe(2);
    expect(addFamily(game)).toBe(false);
    game.state.inventory = { wheat: 100, carrot: 100 };
    game.advance(DAY_MS); // a day settled: 2 foods, approval 55%
    expect(familiesOf(game.state).approval).toBeGreaterThanOrEqual(50);
    ready(game);
    game.state.inventory.wheat = 100;
    game.state.inventory.carrot = 100;
    expect(upgradeCottage(game, c).ok).toBe(true);
    expect(homeRoom(game.state)).toBe(3);
    game.advance(DAY_MS);
    expect(workersOf(game.state).farmers).toBe(3);
    expect(homeList(game.state, 3)[1]).toMatchObject({ id: c.id, room: 2, families: 2 });
  });
});

describe('a level 2 cottage: firewood and gardens', () => {
  it('a full level 2 cottage burns 2 wood a winter day, one per family', () => {
    const game = farm();
    const c = cottage(game);
    setLevel(c, 2);
    addFamily(game);
    addFamily(game);
    game.state.clock.elapsed = WINTER - 1;
    game.state.inventory = { wheat: 100, carrot: 100, wood: 10 };
    game.advance(1);
    expect(familiesOf(game.state).lastDay).toMatchObject({ firewood: 3, firewoodNeeded: 3 });
    expect(game.count('wood')).toBe(7); // farmhouse 1 + the cottage's 2
    // The harsh winter's warning counts hearths the same way.
    expect(harshWinterWood(game.state)).toBe(3 * 2 * SEASON_DAYS);
  });

  it('a 2-family cottage with a garden counts as gardened: gardens are one per home building', () => {
    const game = new Game(bareMap(new Game().state));
    getSlice<ProgressionState>(game.state, PROGRESSION).xp = xpForLevel(10);
    game.earn(1_000_000);
    for (const id of ['wood', 'stone', 'iron']) game.state.inventory[id] = 500;
    const land = game.state.land;
    for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
    const r = game.place(COTTAGE, 4, 4);
    if (!r.ok) throw new Error(r.reason);
    setLevel(r.object, 2);
    const g = game.place('hen-run', 6, 4);
    if (!g.ok) throw new Error(g.reason);
    addFamily(game);
    addFamily(game);
    game.advance(DAY_MS + 1);
    // The farmhouse has none: 1 of 2 home buildings, whatever the 3 families' room.
    expect(familiesOf(game.state).lastDay?.gardens).toEqual({ homes: 2, gardened: 1 });
    expect(familiesOf(game.state).breakdown.find((p) => p.id === 'gardens')).toMatchObject({ label: 'Gardens at 1 of 2 homes', points: Math.round(GARDEN_APPROVAL / 2) });
  });
});

describe('cottage upgrade: demolish and saves', () => {
  it('demolishing a level 2 cottage gives back half the build plus half the upgrade', () => {
    const game = farm();
    const c = cottage(game);
    expect(refundOf(c)).toBe(40);
    expect(materialsRefundOf(c, game.state)).toEqual({ wood: 4 });
    setLevel(c, 2);
    expect(refundOf(c)).toBe(100);
    expect(materialsRefundOf(c, game.state)).toEqual({ wood: 10, stone: 4 });
    // The same rule as an upgraded granary: half of $30 + 5 wood, plus half of the level 2 upgrade's $150 + 16 wood + 8 stone.
    const granary = { ...c, id: 'g', type: 'granary', state: { level: 2 } };
    expect(refundOf(granary)).toBe(90);
    expect(materialsRefundOf(granary, game.state)).toEqual({ wood: 10, stone: 4 });
  });

  it('a save without cottage levels loads them as level 1 with the same farmers; a reload keeps level 2', () => {
    const game = farm();
    const a = cottage(game, 0);
    cottage(game, 1);
    addFamily(game);
    addFamily(game);
    const raw = JSON.parse(serialize(game.state));
    for (const o of raw.state.objects) if (o.type === COTTAGE) delete o.state.level;
    const old = parseSave(JSON.stringify(raw)).state;
    expect(old.objects.filter((o) => o.type === COTTAGE).map((o) => o.state.level)).toEqual([1, 1]);
    expect(workersOf(old).farmers).toBe(3);
    expect(homeRoom(old)).toBe(3);

    setLevel(a, 2);
    const loaded = parseSave(serialize(game.state)).state;
    expect(loaded.objects.find((o) => o.id === a.id)?.state.level).toBe(2);
    expect(homeRoom(loaded)).toBe(4);
  });
});
