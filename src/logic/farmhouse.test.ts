import { describe, expect, it } from 'vitest';
import { getBuildable } from '../data/buildables';
import { FIELD } from '../data/crops';
import { FARMHOUSE, FARMHOUSE_DEF, FARMHOUSE_DOOR, MAX_FARMHOUSE_LEVEL, PATH } from '../data/farmhouse';
import { DAY_MS } from './constants';
import { checkFarmhouseUpgrade, farmhouseChecklist, farmhouseInfo, growFarmhouse, raiseFarmhouse, takeFarmhouseMovedNotice, upgradeFarmhouse } from './farmhouse';
import { familiesOf } from './families';
import { Game } from './game';
import { addTrees, mapOf, treeAt } from './maplayer';
import { perksOf } from './perks';
import { PROGRESSION, type ProgressionState } from './progression';
import { doorOf, farmhouseOf, findRoute, villageCentre } from './roads';
import { parseSave, serialize } from './save';
import { getSlice } from './slices';
import { capacity } from './storage';
import { farmhouseRoom, homeList } from './homes';
import { maxLevelState } from './test-utils';
import type { GameState, PlacedObject } from './types';
import { winterFirewood } from './upgrades';
import { workersOf, type Job } from './workers';
import { xpForLevel } from './unlocks';

const L2 = FARMHOUSE_DEF.levels[1].upgrade!;
const L3 = FARMHOUSE_DEF.levels[2].upgrade!;

/** The classic farm (a built level 1 farmhouse) at farm level `level`, with `families` families and `approval`%. */
function farm({ level = 6, families = 6, approval = 50 } = {}): { game: Game; house: PlacedObject } {
  const game = new Game(maxLevelState());
  getSlice<ProgressionState>(game.state, PROGRESSION).xp = xpForLevel(level);
  workersOf(game.state).farmers = families;
  familiesOf(game.state).approval = approval;
  return { game, house: farmhouseOf(game.state)! };
}

/** Exactly what the level 2 upgrade costs, and a winter's firewood after it. */
function payable(game: Game, families: number, up = L2): void {
  game.state.money = up.cost;
  game.state.inventory = { ...up.materials, wood: (up.materials.wood ?? 0) + winterFirewood(families) };
}

describe('farmhouse levels', () => {
  it('3×3 at every level, door in the middle of the front-left face; levels as the design says', () => {
    expect(getBuildable(FARMHOUSE)!.footprint).toEqual({ w: 3, h: 3 });
    expect(FARMHOUSE_DOOR).toEqual({ x: 1, y: 3 });
    expect(FARMHOUSE_DEF.levels.map((l) => [l.name, l.room, l.store.goods, l.store.materials, l.approval])).toEqual([
      ['Farmhouse', 1, 50, 50, 10],
      ['Manor house', 2, 100, 100, 15],
      ['Manor hall', 3, 150, 150, 20],
    ]);
    expect(L2).toEqual({ cost: 700, materials: { wood: 40, stone: 30, iron: 8 }, farmLevel: 6, families: 6, approval: 50 });
    expect(L3).toEqual({ cost: 1200, materials: { wood: 60, stone: 50, iron: 15 }, farmLevel: 8, families: 10, approval: 60 });
    // A new farmhouse is level 1.
    expect(getBuildable(FARMHOUSE)!.initialState?.({ x: 0, y: 0, now: 0 })).toEqual({ level: 1 });
  });

  it('with every need met the checklist is all ✅; the upgrade pays and raises room, store and approval', () => {
    const { game, house } = farm();
    payable(game, 6);
    const list = farmhouseChecklist(game, house);
    expect(list.lines.map((l) => [l.id, l.ok])).toEqual([
      ['level', true],
      ['families', true],
      ['approval', true],
      ['fuel', true],
      ['cost', true],
    ]);
    expect(list).toMatchObject({ ok: true, next: 2, blocked: null });
    const goods = capacity(game.state, 'goods');
    const upgraded: unknown[] = [];
    game.activity.on('upgraded', (e) => upgraded.push(e));
    expect(upgradeFarmhouse(game, house)).toEqual({ ok: true, level: 2 });
    expect(house.state.level).toBe(2);
    expect(game.state.money).toBe(0);
    expect(game.state.inventory).toEqual({ wood: winterFirewood(6) });
    expect(upgraded).toEqual([{ type: FARMHOUSE, level: 2 }]);
    expect(farmhouseRoom(game.state)).toBe(2);
    expect(homeList(game.state, 6).find((h) => h.type === FARMHOUSE)).toMatchObject({ level: 2, room: 2 });
    expect(capacity(game.state, 'goods')).toBe(goods + 50);
    // The approval it adds shows at the next settled day.
    game.advance(DAY_MS);
    expect(familiesOf(game.state).breakdown).toContainEqual({ id: 'farmhouse', label: 'The manor house oversees the farm', points: 15 });
    expect(farmhouseInfo(game)).toMatchObject({ level: 2, name: 'Manor house', room: 2, store: { goods: 100, materials: 100 }, approval: 15, upgrade: { next: 3, ok: false } });
  });

  it.each([
    ['level', { level: 5 }, /Farm level 6 \(the farm is level 5\)/],
    ['families', { families: 5 }, /At least 6 families \(5 now\)/],
    ['approval', { approval: 49 }, /Approval 50% or more \(49% now\)/],
  ] as const)('an unmet %s line is ❌ and blocks the upgrade', (id, over, text) => {
    const { game, house } = farm(over);
    payable(game, workersOf(game.state).farmers);
    const list = farmhouseChecklist(game, house);
    expect(list.lines.find((l) => l.id === id)).toMatchObject({ ok: false, text: expect.stringMatching(text) });
    expect(list.lines.filter((l) => !l.ok)).toHaveLength(1);
    expect(checkFarmhouseUpgrade(game, house)).toEqual({ ok: false, reason: 'needs' });
    expect(upgradeFarmhouse(game, house)).toEqual({ ok: false, reason: 'needs' });
    expect(house.state.level).toBe(1);
    expect(game.state.money).toBe(L2.cost);
  });

  it("fuel: a winter's firewood left after the upgrade's 40 wood, or it blocks", () => {
    const { game, house } = farm();
    payable(game, 6);
    game.state.inventory.wood! -= 1;
    expect(farmhouseChecklist(game, house).fuel).toMatchObject({ ok: false, text: expect.stringMatching(/after the upgrade's 40/) });
    expect(checkFarmhouseUpgrade(game, house).ok).toBe(false);
  });

  it('cost: short of money or iron is ❌ with what is missing', () => {
    const { game, house } = farm();
    payable(game, 6);
    game.state.money = 650;
    expect(farmhouseChecklist(game, house).cost).toMatchObject({ ok: false, text: expect.stringMatching(/\$50 more/) });
    game.state.money = 700;
    game.state.inventory.iron = 5;
    expect(farmhouseChecklist(game, house).cost).toMatchObject({ ok: false, text: expect.stringMatching(/3 more .*Iron/) });
    expect(checkFarmhouseUpgrade(game, house).ok).toBe(false);
  });

  it('Thrifty takes 20% fewer materials, as for the cottage', () => {
    const { game, house } = farm();
    perksOf(game.state).taken.push({ level: 2, id: 'thrifty' });
    payable(game, 6);
    upgradeFarmhouse(game, house);
    // 32 wood, 24 stone, 7 iron (6.4 rounded up).
    expect(game.state.inventory).toMatchObject({ wood: 40 - 32 + winterFirewood(6), stone: 30 - 24, iron: 8 - 7 });
  });

  it('level 3 asks farm level 8, 10 families, 60% approval; then the top; never down a level; a reload keeps it', () => {
    const { game, house } = farm({ level: 8, families: 10, approval: 60 });
    payable(game, 10);
    upgradeFarmhouse(game, house);
    payable(game, 10, L3);
    expect(farmhouseChecklist(game, house).lines.map((l) => l.text)).toEqual([
      'Farm level 8',
      'At least 10 families',
      'Approval 60% or more',
      `Fuel: a winter's firewood, ${winterFirewood(10)} 🪵 for 10 families`,
      'Cost: $1200 + 60 🪵 Wood + 50 🪨 Stone + 15 🔩 Iron',
    ]);
    expect(upgradeFarmhouse(game, house)).toEqual({ ok: true, level: 3 });
    expect(farmhouseRoom(game.state)).toBe(3);
    expect(farmhouseChecklist(game, house)).toMatchObject({ blocked: 'max', ok: false, next: 3 });
    expect(upgradeFarmhouse(game, house)).toEqual({ ok: false, reason: 'max' });
    // Needs lapsing later change nothing.
    familiesOf(game.state).approval = 0;
    workersOf(game.state).farmers = 1;
    expect(house.state.level).toBe(3);
    const loaded = parseSave(serialize(game.state)).state;
    expect(farmhouseOf(loaded)!.state.level).toBe(3);
    expect(farmhouseRoom(loaded)).toBe(3);
  });

  it('a site cannot be upgraded; the debug +1 level skips the needs up to the top', () => {
    const { game, house } = farm();
    house.site = { workMs: 1000, paid: 0 };
    payable(game, 6);
    expect(checkFarmhouseUpgrade(game, house)).toEqual({ ok: false, reason: 'site' });
    delete house.site;
    game.state.money = 0;
    expect(raiseFarmhouse(game)).toBe(true);
    expect(raiseFarmhouse(game)).toBe(true);
    expect(raiseFarmhouse(game)).toBe(false);
    expect(house.state.level).toBe(MAX_FARMHOUSE_LEVEL);
  });
});

// Old saves -----------------------------------------------------------------------------------------------------------

const fp = (o: PlacedObject) => getBuildable(o.type)?.footprint ?? { w: 1, h: 1 };

/** No two objects share a tile. */
function overlapsNothing(state: GameState): void {
  const seen = new Map<string, string>();
  for (const o of state.objects) {
    const { w, h } = fp(o);
    for (let y = o.y; y < o.y + h; y++) {
      for (let x = o.x; x < o.x + w; x++) {
        expect(seen.get(`${x},${y}`), `${o.id} ${o.type} at ${x},${y}`).toBeUndefined();
        seen.set(`${x},${y}`, o.id);
      }
    }
  }
}

let nextId = 900;
const add = (state: GameState, type: string, x: number, y: number, extra: Partial<PlacedObject> = {}) =>
  state.objects.push({ id: `o${nextId++}`, type, x, y, state: {}, ...extra });

/**
 * The classic farm as a version 17 save had it: the farmhouse 2×2, one row further forward than today's 3×3 (the
 * same door tile), with no level. `tweak` changes the old farm before it is saved.
 */
function oldSave(tweak: (state: GameState, house: PlacedObject) => void = () => {}): { raw: string; house: PlacedObject } {
  const state = maxLevelState();
  const house = farmhouseOf(state)!;
  house.y += 1;
  delete house.state.level;
  tweak(state, house);
  const file = JSON.parse(serialize(state, 1));
  file.version = 17;
  return { raw: JSON.stringify(file), house: structuredClone(house) };
}

const reaches = (state: GameState, o: PlacedObject) => findRoute(state, { x: o.x, y: o.y, ...fp(o) }) !== null;

describe('old saves: the 2×2 farmhouse grows to 3×3', () => {
  it('in place, one row back so the door tile stays: the paths, trees and stumps there go, the buildings around stay', () => {
    const { raw, house: old } = oldSave((state, h) => {
      // A path and a tree on the row it grows into, a cottage beside it, and a farmer on his way into the house.
      add(state, PATH, h.x + 1, h.y - 1);
      addTrees(mapOf(state), [{ x: h.x + 2, y: h.y - 1 }]);
      add(state, 'cottage', h.x + 3, h.y - 1, { state: { level: 1 } });
      add(state, 'well', h.x - 1, h.y + 1);
      const job: Job = { kind: 'build', x: h.x + 1, y: h.y + 1, timer: { start: 0, duration: 10 * DAY_MS }, farmer: 0, target: h.id, route: [] };
      workersOf(state).jobs = [job];
    });
    const state = parseSave(raw).state;
    const house = farmhouseOf(state)!;
    expect(house).toMatchObject({ id: old.id, x: old.x, y: old.y - 1, state: { level: 1 } });
    expect(doorOf(house)).toEqual({ x: old.x + 1, y: old.y + 2 });
    expect(state.objects.some((o) => o.type === PATH && o.x === old.x + 1 && o.y === old.y - 1)).toBe(false);
    expect(treeAt(mapOf(state), old.x + 2, old.y - 1)).toBeUndefined();
    expect(state.objects.filter((o) => o.type === 'cottage' || o.type === 'well')).toHaveLength(2);
    overlapsNothing(state);
    // Still the village centre, its door on a path that reaches the fields.
    expect(villageCentre(state)).toMatchObject({ type: FARMHOUSE, id: old.id, ...doorOf(house) });
    expect(state.objects.some((o) => o.type === PATH && o.x === doorOf(house).x && o.y === doorOf(house).y)).toBe(true);
    for (const f of state.objects.filter((o) => o.type === FIELD)) expect(reaches(state, f)).toBe(true);
    // The farmer walking there went back to idle; the store and family are the farmhouse's still.
    expect(workersOf(state).jobs).toEqual([]);
    expect(farmhouseRoom(state)).toBe(1);
    expect(capacity(state, 'goods')).toBeGreaterThanOrEqual(50);
    expect(takeFarmhouseMovedNotice(state)).toBe(false);
  });

  it('in place over its old footprint another way when the row behind is taken', () => {
    const { raw, house: old } = oldSave((state, h) => {
      for (let x = h.x - 1; x <= h.x + 2; x++) add(state, 'well', x, h.y - 1);
    });
    const state = parseSave(raw).state;
    const house = farmhouseOf(state)!;
    // Over the old 2×2 and the door's row: the door moves one tile forward, and gets a path joined to the old one.
    expect(house).toMatchObject({ id: old.id, x: old.x, y: old.y });
    overlapsNothing(state);
    expect(state.objects.some((o) => o.type === PATH && o.x === doorOf(house).x && o.y === doorOf(house).y)).toBe(true);
    for (const f of state.objects.filter((o) => o.type === FIELD)) expect(reaches(state, f)).toBe(true);
    expect(takeFarmhouseMovedNotice(state)).toBe(false);
  });

  it('boxed in: moves to the nearest free 3×3 by a path, joined up, with a notice once', () => {
    const { raw, house: old } = oldSave((state, h) => {
      // Every 3×3 over the old footprint needs the row behind or a column beside it: all built on.
      for (let x = h.x - 1; x <= h.x + 2; x++) add(state, 'well', x, h.y - 1);
      for (const y of [h.y, h.y + 1]) {
        add(state, 'well', h.x - 1, y);
        add(state, 'well', h.x + 2, y);
      }
    });
    const state = parseSave(raw).state;
    const house = farmhouseOf(state)!;
    expect(house.id).toBe(old.id);
    expect(house.state.level).toBe(1);
    expect([house.x, house.y]).not.toEqual([old.x, old.y]);
    overlapsNothing(state);
    const door = doorOf(house);
    expect(state.objects.some((o) => o.type === PATH && o.x === door.x && o.y === door.y)).toBe(true);
    // Everything the old farmhouse's paths reached, the new one reaches.
    for (const f of state.objects.filter((o) => o.type === FIELD)) expect(reaches(state, f)).toBe(true);
    expect(takeFarmhouseMovedNotice(state)).toBe(true);
    expect(takeFarmhouseMovedNotice(state)).toBe(false);
  });

  it('a save without a farmhouse (a new farm since it is built later) is untouched', () => {
    const state = maxLevelState();
    state.objects = state.objects.filter((o) => o.type !== FARMHOUSE);
    const before = state.objects.map((o) => [o.id, o.type, o.x, o.y]);
    const file = JSON.parse(serialize(state, 1));
    file.version = 17;
    const loaded = parseSave(JSON.stringify(file)).state;
    expect(loaded.objects.map((o) => [o.id, o.type, o.x, o.y])).toEqual(before);
    expect(growFarmhouse(loaded)).toBe('none');
  });

  it('a version 18 save loads as it is', () => {
    const state = maxLevelState();
    const house = farmhouseOf(state)!;
    const loaded = parseSave(serialize(state)).state;
    expect(farmhouseOf(loaded)).toMatchObject({ x: house.x, y: house.y });
  });
});
