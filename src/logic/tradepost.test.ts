import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATH } from '../data/farmhouse';
import { TRADING_POST } from '../data/trade';
import { START_LAND } from './constants';
import { footprintOf, Game } from './game';
import { roadOf, ROAD_SLICE, roadTiles } from './mainroad';
import { buy, sell } from './market';
import { fulfilOrder, ordersOf, updateOrders } from './orders';
import { PROGRESSION, type ProgressionState } from './progression';
import { connectToFarmhouse, doorOf, farmhouseOf } from './roads';
import { parseSave, serialize } from './save';
import { getSlice } from './slices';
import { createNewGame } from './state';
import { setTradeGateEnabled } from './tradegate';
import { takeTradeNotice, TRADE_SLICE, tradeLink, wouldLink } from './tradepost';
import { sellToTrader, traderNow, traderPassing, wagonTile } from './trader';
import type { PlacedObject } from './types';
import { xpForLevel } from './unlocks';

beforeEach(() => setTradeGateEnabled(true));
afterEach(() => setTradeGateEnabled(false));

/** A new farm (with its own random map and road), money and wood to spare. */
function farm(level = 1): Game {
  const game = new Game(createNewGame());
  getSlice<ProgressionState>(game.state, PROGRESSION).xp = xpForLevel(level);
  game.earn(5000);
  // Room for more: the farmhouse holds 30 materials.
  game.state.inventory.wood = 20;
  return game;
}

/** A free spot for a trading post on the starting land. */
function postSpot(game: Game): { x: number; y: number } {
  for (let y = START_LAND.y; y < START_LAND.y + START_LAND.h; y++) {
    for (let x = START_LAND.x; x < START_LAND.x + START_LAND.w; x++) if (game.checkPlacement(TRADING_POST, x, y).ok) return { x, y };
  }
  throw new Error('no room for a trading post');
}

function placePost(game: Game, site = false): PlacedObject {
  const { x, y } = postSpot(game);
  const r = game.place(TRADING_POST, x, y, { site });
  if (!r.ok) throw new Error(r.reason);
  return r.object;
}

const areaOf = (o: PlacedObject) => ({ x: o.x, y: o.y, ...footprintOf(o) });

/** The road tile nearest the farmhouse door. */
function nearestRoadTile(game: Game): { x: number; y: number } {
  const d = doorOf(farmhouseOf(game.state)!);
  return [...roadTiles(game.state)].sort((a, b) => Math.abs(a.x - d.x) + Math.abs(a.y - d.y) - (Math.abs(b.x - d.x) + Math.abs(b.y - d.y)))[0];
}

/** Lays free paths from the farmhouse door to the road; returns the path tile that touches it. */
function pathToRoad(game: Game): PlacedObject {
  const t = nearestRoadTile(game);
  expect(connectToFarmhouse(game.state, { ...t, w: 1, h: 1 })).toBe(true);
  const road = new Set(roadTiles(game.state).map((r) => `${r.x},${r.y}`));
  const touches = (o: PlacedObject) => [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => road.has(`${o.x + dx},${o.y + dy}`));
  const joints = game.state.objects.filter((o) => o.type === PATH && touches(o));
  expect(joints).toHaveLength(1);
  return joints[0];
}

/** A farm with a finished trading post linked to the main road. */
function linked(level = 1): { game: Game; post: PlacedObject; joint: PlacedObject } {
  const game = farm(level);
  const post = placePost(game);
  expect(connectToFarmhouse(game.state, areaOf(post))).toBe(true);
  const joint = pathToRoad(game);
  return { game, post, joint };
}

describe('trading post', () => {
  it('is a 2×2 Storage building for $60 and 10 wood at level 1, built by a farmer', () => {
    const game = farm();
    const post = placePost(game, true);
    expect(footprintOf(post)).toEqual({ w: 2, h: 2 });
    expect(post.site).toBeDefined();
    expect(game.money).toBe(5000 + 500 - 60);
    expect(game.count('wood')).toBe(10);
  });

  it('a new farm cannot trade: Market, Orders and the trader are closed', () => {
    const game = farm(5);
    expect(tradeLink(game.state)).toMatchObject({ post: null, connected: false, reason: 'no-post' });
    game.state.inventory.wheat = 10;
    expect(sell(game, 'wheat', 5)).toBe(0);
    expect(game.count('wheat')).toBe(10);
    expect(buy(game, 'wood', 5)).toEqual({ ok: false, reason: 'closed' });
    updateOrders(game.state);
    const slot = ordersOf(game.state).slots.findIndex((s) => s.order);
    for (const it of ordersOf(game.state).slots[slot].order!.items) game.state.inventory[it.itemId] = it.qty;
    expect(fulfilOrder(game, slot)).toBeNull();
    traderNow(game);
    expect(sellToTrader(game, 0, 1)).toEqual({ ok: false, reason: 'closed' });
  });

  it('is linked once the farmhouse paths reach both it and the main road, and trade opens', () => {
    const game = farm();
    const site = placePost(game, true);
    expect(tradeLink(game.state).reason).toBe('building');
    delete site.site;
    expect(tradeLink(game.state).reason).toBe('no-path');
    expect(connectToFarmhouse(game.state, areaOf(site))).toBe(true);
    expect(tradeLink(game.state)).toMatchObject({ connected: false, reason: 'no-road' });
    pathToRoad(game);
    expect(tradeLink(game.state)).toMatchObject({ post: site, connected: true, reason: null });
    game.state.inventory.wheat = 10;
    expect(sell(game, 'wheat', 5)).toBeGreaterThan(0);
    expect(buy(game, 'wood', 1)).toMatchObject({ ok: true, qty: 1 });
    updateOrders(game.state);
    const slot = ordersOf(game.state).slots.findIndex((s) => s.order);
    for (const it of ordersOf(game.state).slots[slot].order!.items) game.state.inventory[it.itemId] = it.qty + 1;
    expect(fulfilOrder(game, slot)).toBeGreaterThan(0);
  });

  it('demolishing the path that joins the road closes trade again; mending it opens it', () => {
    const { game, joint } = linked();
    expect(tradeLink(game.state).connected).toBe(true);
    expect(game.demolish(joint.id)).not.toBeNull();
    expect(tradeLink(game.state)).toMatchObject({ connected: false, reason: 'no-road' });
    game.state.inventory.wheat = 3;
    expect(sell(game, 'wheat')).toBe(0);
    expect(game.place(PATH, joint.x, joint.y).ok).toBe(true);
    expect(tradeLink(game.state).connected).toBe(true);
  });

  it('a second post adds nothing: one linked post is enough', () => {
    const { game, post } = linked();
    placePost(game);
    expect(tradeLink(game.state)).toMatchObject({ post, connected: true });
  });

  it('the build ghost knows whether a post would be linked where it stands', () => {
    const game = farm();
    const { x, y } = postSpot(game);
    expect(wouldLink(game.state, x, y)).toBe(false);
    pathToRoad(game);
    // Somewhere next to the farmhouse door's path network.
    const door = doorOf(farmhouseOf(game.state)!);
    let found = false;
    for (let dy = -3; dy <= 2 && !found; dy++) {
      for (let dx = -3; dx <= 2 && !found; dx++) {
        if (game.checkPlacement(TRADING_POST, door.x + dx, door.y + dy).ok && wouldLink(game.state, door.x + dx, door.y + dy)) found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe('the travelling trader', () => {
  it('parks next to the linked trading post, on a free tile, and trades', () => {
    const { game, post } = linked(5);
    const visit = traderNow(game);
    const tile = wagonTile(game.state)!;
    expect(tile).toEqual(visit.tile);
    const fp = footprintOf(post);
    const dx = Math.max(post.x - tile.x, 0, tile.x - (post.x + fp.w - 1));
    const dy = Math.max(post.y - tile.y, 0, tile.y - (post.y + fp.h - 1));
    expect(dx + dy).toBe(1);
    expect(game.objectAt(tile.x, tile.y)).toBeUndefined();
    expect(traderPassing(game.state)).toBe(false);
    game.state.inventory[visit.wants[0].item] = 1;
    expect(sellToTrader(game, 0, 1).ok).toBe(true);
  });

  it('without a linked post he drives through: no wagon, nothing traded', () => {
    const game = farm(5);
    traderNow(game);
    expect(wagonTile(game.state)).toBeNull();
    expect(traderPassing(game.state)).toBe(true);
  });

  it('when the link breaks while he is here, he leaves the post', () => {
    const { game, joint } = linked(5);
    traderNow(game);
    expect(wagonTile(game.state)).not.toBeNull();
    game.demolish(joint.id);
    expect(wagonTile(game.state)).toBeNull();
    expect(traderPassing(game.state)).toBe(true);
  });
});

describe('older saves (version 15)', () => {
  /** A version-15 save: no road, no trading post, an active "Buy 10 wood" goal. */
  function v15() {
    const state = createNewGame();
    delete state.ext[ROAD_SLICE];
    delete state.ext[TRADE_SLICE];
    getSlice<ProgressionState>(state, PROGRESSION).goals = [
      { id: 'sell-wheat', progress: 3 },
      { id: 'buy-wood', progress: 4 },
    ];
    // Something built out where a road might run: a field near each edge.
    state.objects.push({ id: 'o900', type: 'field', x: 10, y: 4, state: {} }, { id: 'o901', type: 'field', x: 30, y: 42, state: {} });
    state.objects.push({ id: 'o902', type: 'field', x: 3, y: 20, state: {} }, { id: 'o903', type: 'field', x: 59, y: 30, state: {} });
    state.nextObjectId = 1000;
    return { version: 15, savedAt: 1, state };
  }

  it('get a road from their seed that misses their buildings, keep their goals ("buy-wood" renamed) and are told once', () => {
    const raw = v15();
    const loaded = parseSave(JSON.stringify(raw)).state;
    const road = roadOf(loaded);
    expect(road.tiles.length).toBeGreaterThan(40);
    const game = new Game(loaded);
    for (const t of road.tiles) expect(game.objectAt(t.x, t.y), `${t.x},${t.y}`).toBeUndefined();
    expect(getSlice<ProgressionState>(loaded, PROGRESSION).goals).toEqual([
      { id: 'sell-wheat', progress: 3 },
      { id: 'build-trading-post', progress: 0 },
    ]);
    expect(takeTradeNotice(loaded)).toBe(true);
    expect(takeTradeNotice(loaded)).toBe(false);
    // The same save loads the same road; saved and loaded again it stays.
    expect(roadOf(parseSave(JSON.stringify(raw)).state).tiles).toEqual(road.tiles);
    const again = parseSave(serialize(loaded)).state;
    expect(roadOf(again).tiles).toEqual(road.tiles);
    expect(takeTradeNotice(again)).toBe(false);
    // Trade is closed until they build and link a post.
    expect(tradeLink(loaded).connected).toBe(false);
  });

  it('a new farm is not told', () => {
    expect(takeTradeNotice(createNewGame())).toBe(false);
  });
});
