import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getBuildable } from '../data/buildables';
import { CAMP, CAMP_FAMILIES, CAMP_SUPPLIES } from '../data/camp';
import { FIELD } from '../data/crops';
import { COTTAGE } from '../data/families';
import { FARMHOUSE, FARMHOUSE_APPROVAL, FARMHOUSE_LEVEL, PATH } from '../data/farmhouse';
import { FARMHOUSE_STORE, SETTLERS_YARD } from '../data/storage';
import { buildWorkMs, STARTING_FARMERS } from '../data/workers';
import { campInfo, campOf, START_CAMP } from './camp';
import { DAY_MS, START_LAYOUT } from './constants';
import { familiesOf } from './families';
import { Game } from './game';
import { buy } from './market';
import { homeRoom, houseRoom } from './homes';
import { PROGRESSION, type ProgressionState } from './progression';
import { connectToFarmhouse, farmhouseOf, pathNetwork, findRoute, villageCentre, villageInfo } from './roads';
import { deserialize, serialize } from './save';
import { getSlice } from './slices';
import { createNewGame } from './state';
import { capacity } from './storage';
import { bareMap, stockMaterials, useClassicStart } from './test-utils';
import type { PlacedObject } from './types';
import { xpForLevel } from './unlocks';
import { workersOf } from './workers';

// These tests are about the new start: only the camp.
beforeAll(() => useClassicStart(false));
afterAll(() => useClassicStart(true));

/** A free row south of the camp for cottages and the farmhouse, joined to the tent's path by `connect`. */
const ROW = { x: START_LAYOUT.x, y: START_LAYOUT.y + 6 };

function newFarm({ level = 1 } = {}): Game {
  const state = bareMap(createNewGame());
  getSlice<ProgressionState>(state, PROGRESSION).xp = xpForLevel(level);
  const game = new Game(state);
  game.earn(10_000);
  return game;
}

const area = (o: PlacedObject) => ({ x: o.x, y: o.y, ...getBuildable(o.type)!.footprint });

/** A level-4 farm with a level 3 storehouse full of materials, to pay for the farmhouse more than once. */
function richFarm(): Game {
  const game = newFarm({ level: 4 });
  place(game, 'storehouse', ROW.x + 8, ROW.y).state.level = 3;
  stockMaterials(game.state, 60);
  return game;
}

/**
 * Places `type` at (x, y), or the first free spot right of it (paths laid earlier may be in the way), joined to the
 * village by free paths; finished unless `site`.
 */
function place(game: Game, type: string, x: number, y: number, { site = false } = {}): PlacedObject {
  let dx = 0;
  while (dx < 20 && game.checkPlacement(type, x + dx, y).ok === false && (game.checkPlacement(type, x + dx, y) as { reason: string }).reason === 'occupied') dx++;
  const r = game.place(type, x + dx, y, { site });
  if (!r.ok) throw new Error(`${type}: ${r.reason}`);
  expect(connectToFarmhouse(game.state, area(r.object))).toBe(true);
  return r.object;
}

/** Uses up the camp's supplies the way the game takes stock out. */
function useUpSupplies(game: Game): void {
  for (const [id, n] of Object.entries(CAMP_SUPPLIES)) expect(game.removeItem(id, Math.min(n!, game.count(id)))).toBe(true);
}

describe('a new game', () => {
  it('is only the camp and the path in front of its tent: no farmhouse, fields or roads; two families live in the tent', () => {
    const game = newFarm();
    const camp = campOf(game.state)!;
    expect(camp).toMatchObject({ type: CAMP, ...START_CAMP });
    expect(game.state.objects.map((o) => [o.type, o.x, o.y])).toEqual([
      [CAMP, START_CAMP.x, START_CAMP.y],
      [PATH, camp.x + 1, camp.y + 3],
    ]);
    expect(farmhouseOf(game.state)).toBeUndefined();
    expect(game.objectsOfType(FIELD)).toHaveLength(0);
    expect(workersOf(game.state).farmers).toBe(STARTING_FARMERS);
    expect(STARTING_FARMERS).toBe(2);
    expect(campInfo(game.state)).toMatchObject({ families: CAMP_FAMILIES, waiting: 0, packed: false });
    // The tent houses them but has no room for newcomers.
    expect(homeRoom(game.state)).toBe(2);
    expect(houseRoom(game.state)).toBe(0);
    // No farmhouse store: the camp's supplies have room, and the settlers' yard a little more for materials.
    expect(capacity(game.state, 'goods')).toBe(30);
    expect(capacity(game.state, 'materials')).toBe(60 + SETTLERS_YARD.materials);
  });

  it('the village centre is the tile in front of the tent; window.farm.village says so', () => {
    const game = newFarm();
    const camp = campOf(game.state)!;
    expect(villageCentre(game.state)).toEqual({ type: CAMP, id: camp.id, x: camp.x + 1, y: camp.y + 3 });
    expect(villageInfo(game.state)).toEqual({ centre: villageCentre(game.state), farmhouse: null });
  });

  it('a save of the new start stays without a farmhouse when loaded', () => {
    const game = newFarm();
    const loaded = deserialize(serialize(game.state));
    expect(farmhouseOf(loaded)).toBeUndefined();
    expect(loaded.objects).toEqual(game.state.objects);
    expect(campInfo(loaded)).toEqual(campInfo(game.state));
    expect(workersOf(loaded).farmers).toBe(2);
  });
});

describe('storage before the farmhouse', () => {
  it('a farm that spent the camp’s wood and stone first can still buy a storehouse’s worth and build it', () => {
    const game = newFarm();
    expect(game.removeItem('wood', CAMP_SUPPLIES.wood!)).toBe(true);
    expect(game.removeItem('stone', CAMP_SUPPLIES.stone!)).toBe(true);
    // The settlers' yard has room for what a storehouse takes.
    expect(capacity(game.state, 'materials')).toBe(SETTLERS_YARD.materials);
    const cost = getBuildable('storehouse')!.materials!;
    expect(buy(game, 'wood', cost.wood!)).toMatchObject({ ok: true, qty: cost.wood });
    expect(buy(game, 'stone', cost.stone!)).toMatchObject({ ok: true, qty: cost.stone });
    place(game, 'storehouse', ROW.x, ROW.y);
    expect(capacity(game.state, 'materials')).toBe(SETTLERS_YARD.materials + 60);
  });
});

describe('placement from the village centre', () => {
  it('the path network (the trading post’s link to the main road) starts at the camp on a new farm', () => {
    const game = newFarm();
    const centre = villageCentre(game.state)!;
    expect(pathNetwork(game.state).has(`${centre.x},${centre.y}`)).toBe(true);
  });

  it('a field is worked once a path joins it to the tent, and not before', () => {
    const game = newFarm();
    const r = game.place(FIELD, START_LAYOUT.x, START_LAYOUT.y, { site: true });
    if (!r.ok) throw new Error(r.reason);
    expect(findRoute(game.state, area(r.object))).toBeNull();
    expect(connectToFarmhouse(game.state, area(r.object))).toBe(true);
    const route = findRoute(game.state, area(r.object))!;
    // The road starts at the tent: on its front tile or another one along its edges.
    const camp = campOf(game.state)!;
    const first = route.tiles[0];
    expect(first.x >= camp.x - 1 && first.x <= camp.x + 3 && first.y >= camp.y - 1 && first.y <= camp.y + 3).toBe(true);
    // A free farmer walks out and builds it.
    game.advance(DAY_MS / 4);
    expect(r.object.site).toBeUndefined();
  });
});

describe('homes and the tent', () => {
  it('newcomers need free cottage room: the tent never takes one', () => {
    const game = newFarm();
    game.advance(DAY_MS);
    // Fed from the camp, approval high enough, but no house has room.
    expect(familiesOf(game.state).approval).toBeGreaterThanOrEqual(50);
    expect(familiesOf(game.state).nextArrivalAt).toBeNull();
    place(game, COTTAGE, ROW.x, ROW.y);
    expect(houseRoom(game.state)).toBe(1);
    expect(homeRoom(game.state)).toBe(3);
    game.advance(DAY_MS);
    expect(workersOf(game.state).farmers).toBe(3);
  });

  it('with the supplies used up and no room the empty tent waits; once its families fit in cottages it packs away and they move in', () => {
    const game = newFarm();
    const camp = campOf(game.state)!;
    useUpSupplies(game);
    expect(campOf(game.state)).toBe(camp);
    // Wood for two cottages, bought since (the camp keeps no room for it).
    game.state.inventory.wood = 16;
    expect(campInfo(game.state)).toMatchObject({ left: {}, families: 2, waiting: 2, packed: false });
    // One cottage: the first newcomer would take it, so the tent still waits for one of its own.
    const first = place(game, COTTAGE, ROW.x, ROW.y);
    game.advance(1);
    expect(campInfo(game.state)).toMatchObject({ waiting: 1 });
    // Fed and happy, but the free room is the tent's: no newcomer takes it.
    game.state.inventory.wheat = 20;
    game.state.inventory.carrot = 20;
    game.advance(2 * DAY_MS);
    expect(familiesOf(game.state).approval).toBeGreaterThanOrEqual(50);
    expect(workersOf(game.state).farmers).toBe(2);
    expect(campInfo(game.state)).toMatchObject({ waiting: 1 });
    // While the tent still had supplies, the same room would have gone to a newcomer.
    const early = newFarm();
    place(early, COTTAGE, ROW.x, ROW.y);
    early.advance(DAY_MS);
    expect(workersOf(early.state).farmers).toBe(3);
    expect(villageCentre(game.state)).toMatchObject({ type: CAMP });
    const removed: string[] = [];
    game.events.on('objectRemoved', (o) => removed.push(o.type));
    // The second cottage is room for both: the tent goes at once.
    place(game, COTTAGE, ROW.x + 3, ROW.y);
    expect(campOf(game.state)).toBeUndefined();
    expect(removed).toEqual([CAMP]);
    expect(campInfo(game.state)).toMatchObject({ packed: true, families: 0, waiting: 0 });
    // Its families live in the cottages now, and the oldest one is the village centre.
    expect(workersOf(game.state).farmers).toBe(2);
    expect(homeRoom(game.state)).toBe(2);
    expect(villageCentre(game.state)).toEqual({ type: COTTAGE, id: first.id, x: first.x + 1, y: first.y + 2 });
  });

  it('roads that met only at the tent stay joined when it is packed away', () => {
    const game = newFarm();
    const camp = campOf(game.state)!;
    // A field west of the tent, its road leaving from the tent's west side: joined to the front path only through the tent.
    const field = game.place(FIELD, camp.x - 4, camp.y);
    if (!field.ok) throw new Error(field.reason);
    for (let x = camp.x - 2; x < camp.x; x++) expect(game.place(PATH, x, camp.y + 1).ok).toBe(true);
    expect(findRoute(game.state, area(field.object))).not.toBeNull();
    const added: string[] = [];
    game.events.on('objectAdded', (o) => added.push(o.type));
    useUpSupplies(game);
    game.state.inventory.wood = 16;
    // The cottages south of the tent, their roads leaving from its front.
    place(game, COTTAGE, camp.x, camp.y + 5);
    place(game, COTTAGE, camp.x + 3, camp.y + 5);
    expect(campOf(game.state)).toBeUndefined();
    expect(villageCentre(game.state)).toMatchObject({ type: COTTAGE });
    // Free paths over the tent's old tiles join the field's road to the new centre, and are drawn.
    expect(findRoute(game.state, area(field.object))).not.toBeNull();
    expect(added.filter((t) => t === PATH).length).toBeGreaterThan(0);
  });

  it('a tent family is the one to leave while the tent stands', () => {
    const game = newFarm();
    place(game, COTTAGE, ROW.x, ROW.y);
    game.advance(DAY_MS);
    expect(workersOf(game.state).farmers).toBe(3);
    // Nothing to eat for two days: one family leaves, out of the tent.
    game.state.inventory = {};
    game.advance(2 * DAY_MS);
    expect(workersOf(game.state).farmers).toBe(2);
    expect(campInfo(game.state)).toMatchObject({ families: 1 });
    expect(houseRoom(game.state)).toBe(1);
  });
});

describe('the farmhouse', () => {
  it('is in 🏠 Homes from level 4 for $400 + 30 wood + 20 stone + 4 iron, and takes twice a cottage’s work', () => {
    expect(getBuildable(FARMHOUSE)).toMatchObject({
      category: 'homes',
      cost: 400,
      materials: { wood: 30, stone: 20, iron: 4 },
      unlockLevel: FARMHOUSE_LEVEL,
      footprint: { w: 2, h: 2 },
      unique: true,
      permanent: true,
    });
    expect(FARMHOUSE_LEVEL).toBe(4);
    expect(buildWorkMs(FARMHOUSE)).toBe(2 * buildWorkMs(COTTAGE));
    expect(newFarm({ level: 3 }).checkPlacement(FARMHOUSE, ROW.x, ROW.y)).toEqual({ ok: false, reason: 'level' });
  });

  it('one per farm: a second can’t be placed (a site counts), and once built it can’t be demolished', () => {
    const game = richFarm();
    const house = place(game, FARMHOUSE, ROW.x, ROW.y, { site: true });
    // Anywhere: the rule is the farm's, not the spot's.
    expect(game.checkPlacement(FARMHOUSE, ROW.x, ROW.y + 4)).toEqual({ ok: false, reason: 'built' });
    // The site can still be cancelled; then it can be placed again.
    expect(game.checkDemolish(house.id).ok).toBe(true);
    game.demolish(house.id);
    expect(game.checkPlacement(FARMHOUSE, ROW.x, ROW.y + 4)).toEqual({ ok: true });
    const built = place(game, FARMHOUSE, ROW.x, ROW.y + 4);
    expect(game.demolish(built.id)).toBeNull();
    expect(game.checkDemolish(built.id)).toEqual({ ok: false, reason: 'fixed' });
  });

  it('once built moves the village centre to its door, houses a family, adds its store and +10 approval', () => {
    const game = richFarm();
    const house = place(game, FARMHOUSE, ROW.x, ROW.y, { site: true });
    // A site is nothing yet.
    expect(villageCentre(game.state)).toMatchObject({ type: CAMP });
    expect(houseRoom(game.state)).toBe(0);
    expect(villageInfo(game.state).farmhouse).toBeNull();
    game.advance(DAY_MS / 2);
    expect(house.site).toBeUndefined();
    expect(villageCentre(game.state)).toEqual({ type: FARMHOUSE, id: house.id, x: house.x + 1, y: house.y + 2 });
    expect(villageInfo(game.state).farmhouse).toBe(house.id);
    expect(houseRoom(game.state)).toBe(1);
    // Its store of 50 + 50 takes over from the settlers' yard.
    expect(FARMHOUSE_STORE).toEqual({ goods: 50, materials: 50 });
    const camp = campInfo(game.state)!.room;
    expect(capacity(game.state, 'goods')).toBe(camp.goods + 50);
    expect(capacity(game.state, 'materials')).toBe(camp.materials + 300 + 50);
    game.advance(DAY_MS);
    expect(familiesOf(game.state).breakdown).toContainEqual({ id: 'farmhouse', label: 'A farmhouse oversees the farm', points: FARMHOUSE_APPROVAL });
    // A newcomer moves into it.
    expect(workersOf(game.state).farmers).toBe(3);
    // Routes still reach what the tent's path reached.
    const field = place(game, FIELD, START_LAYOUT.x, START_LAYOUT.y);
    expect(findRoute(game.state, area(field))).not.toBeNull();
  });
});
