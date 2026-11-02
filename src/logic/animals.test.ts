import { describe, expect, it } from 'vitest';
import { ANIMALS, FEED_PACK, PENS } from '../data/animals';
import {
  animalsOf,
  animalStatus,
  buyAnimal,
  buyFeed,
  checkBuyAnimal,
  collect,
  feedAll,
  feedNeeded,
  readyCount,
  starvingAnimals,
  winterFeedNeed,
  type PenState,
} from './animals';
import { DAY_MS, START_LAND } from './constants';
import { catchUp } from './offline';
import { familiesOf } from './families';
import { Game } from './game';
import { SEASON_MS } from './seasons';
import { maxLevelState } from './test-utils';
import { deserialize, parseSave, serialize } from './save';
import type { PlacedObject } from './types';

// Free land below the starting fields, the farmhouse and the road between them.
const ox = START_LAND.x;
const oy = START_LAND.y + 8;

function pen(game: Game, type: 'coop' | 'pasture', x = ox, y = oy): PlacedObject<PenState> {
  const r = game.place(type, x, y);
  if (!r.ok) throw new Error(`could not place ${type}: ${r.reason}`);
  return r.object as PlacedObject<PenState>;
}

/** A farm at the first moment of its first winter, when animals eat feed (the rest of the year they graze). */
function winterState() {
  const state = maxLevelState();
  state.clock.elapsed = 3 * SEASON_MS;
  return state;
}

/** Advances game time by `ms` (×1 speed, in clamped frames). */
function wait(game: Game, ms: number): void {
  game.setSpeed(60);
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, 250 * 60);
    game.tick(step / 60);
    left -= step;
  }
  game.setSpeed(1);
}

describe('building pens', () => {
  it('a coop costs $100 + 8 wood and a pasture $230 + 12 wood', () => {
    const g = new Game(maxLevelState());
    const wood = g.count('wood');
    pen(g, 'coop');
    expect(g.money).toBe(400);
    expect(g.count('wood')).toBe(wood - 8);
    pen(g, 'pasture', ox + 4, oy);
    expect(g.money).toBe(170);
    expect(g.count('wood')).toBe(wood - 20);
    expect(PENS.coop.footprint).toEqual({ w: 3, h: 3 });
    expect(PENS.pasture.footprint).toEqual({ w: 4, h: 4 });
  });

  it('a new pen starts empty', () => {
    const g = new Game(maxLevelState());
    expect(animalsOf(pen(g, 'coop'))).toEqual([]);
  });
});

describe('buying animals', () => {
  it('charges the price and adds a hungry animal', () => {
    const g = new Game(maxLevelState());
    const coop = pen(g, 'coop');
    expect(buyAnimal(g, coop, 'chicken')).toEqual({ ok: true });
    expect(g.money).toBe(500 - PENS.coop.cost - 60);
    expect(coop.state.animals).toEqual([{ kind: 'chicken', timer: null, hungrySince: g.now }]);
    expect(animalStatus(g.state.clock, coop.state.animals[0])).toBe('hungry');
  });

  it('refuses beyond capacity without charging', () => {
    const g = new Game(maxLevelState());
    const coop = pen(g, 'coop');
    g.earn(10_000);
    for (let i = 0; i < 6; i++) expect(buyAnimal(g, coop, 'chicken').ok).toBe(true);
    const money = g.money;
    expect(buyAnimal(g, coop, 'chicken')).toEqual({ ok: false, reason: 'full' });
    expect(coop.state.animals).toHaveLength(6);
    expect(g.money).toBe(money);
  });

  it('a pasture holds 4 cows or sheep, mixed', () => {
    const g = new Game(maxLevelState());
    g.earn(10_000);
    const pasture = pen(g, 'pasture');
    for (const kind of ['cow', 'sheep', 'cow', 'sheep'] as const) expect(buyAnimal(g, pasture, kind).ok).toBe(true);
    expect(buyAnimal(g, pasture, 'sheep')).toEqual({ ok: false, reason: 'full' });
    expect(g.money).toBe(10_500 - PENS.pasture.cost - 2 * 250 - 2 * 180);
  });

  it('refuses when the player cannot afford it, never going negative', () => {
    const g = new Game(maxLevelState());
    const pasture = pen(g, 'pasture');
    g.spend(g.money - 200);
    expect(checkBuyAnimal(g, pasture, 'cow')).toEqual({ ok: false, reason: 'money' });
    expect(buyAnimal(g, pasture, 'cow')).toEqual({ ok: false, reason: 'money' });
    expect(g.money).toBe(200);
    expect(pasture.state.animals).toHaveLength(0);
    expect(buyAnimal(g, pasture, 'sheep').ok).toBe(true);
    expect(g.money).toBe(20);
  });

  it('animals only live in their own kind of pen', () => {
    const g = new Game(maxLevelState());
    g.earn(10_000);
    const coop = pen(g, 'coop');
    const pasture = pen(g, 'pasture', ox + 4, oy);
    expect(buyAnimal(g, coop, 'cow')).toEqual({ ok: false, reason: 'wrong-pen' });
    expect(buyAnimal(g, pasture, 'chicken')).toEqual({ ok: false, reason: 'wrong-pen' });
  });
});

describe('feeding', () => {
  it('buys 5 feed for $25, refusing when short', () => {
    const g = new Game(winterState());
    expect(buyFeed(g)).toEqual({ ok: true });
    expect(g.count('feed')).toBe(FEED_PACK.qty);
    expect(g.money).toBe(500 - FEED_PACK.price);
    g.spend(g.money - 10);
    expect(buyFeed(g)).toEqual({ ok: false, reason: 'money' });
    expect(g.count('feed')).toBe(5);
    expect(g.money).toBe(10);
  });

  it('animals nobody lets out to graze produce nothing', () => {
    const g = new Game(maxLevelState());
    const coop = pen(g, 'coop');
    buyAnimal(g, coop, 'chicken');
    wait(g, 10 * ANIMALS.chicken.cycleMs);
    expect(animalStatus(g.state.clock, coop.state.animals[0])).toBe('hungry');
    expect(collect(g, coop)).toEqual({});
    expect(g.count('egg')).toBe(0);
  });

  it('feeds every hungry animal it can and never takes feed below zero', () => {
    const g = new Game(winterState());
    g.earn(10_000);
    const pasture = pen(g, 'pasture');
    buyAnimal(g, pasture, 'cow');
    buyAnimal(g, pasture, 'sheep');
    buyAnimal(g, pasture, 'cow');
    g.addItem('feed', 3);
    expect(feedNeeded(g, pasture)).toBe(5);
    // Cow takes 2, sheep takes 1, the second cow cannot be fed with nothing left.
    expect(feedAll(g, pasture)).toBe(2);
    expect(g.count('feed')).toBe(0);
    expect(pasture.state.animals.map((a) => animalStatus(g.state.clock, a))).toEqual(['producing', 'producing', 'hungry']);
    expect(feedAll(g, pasture)).toBe(0);
    expect(g.count('feed')).toBe(0);
  });

  it('skips an animal that needs more feed than is left but feeds cheaper ones after it', () => {
    const g = new Game(winterState());
    g.earn(10_000);
    const pasture = pen(g, 'pasture');
    buyAnimal(g, pasture, 'cow');
    buyAnimal(g, pasture, 'sheep');
    g.addItem('feed', 1);
    expect(feedAll(g, pasture)).toBe(1);
    expect(pasture.state.animals.map((a) => animalStatus(g.state.clock, a))).toEqual(['hungry', 'producing']);
  });

  it('does not feed an animal that is already producing', () => {
    const g = new Game(winterState());
    const coop = pen(g, 'coop');
    buyAnimal(g, coop, 'chicken');
    g.addItem('feed', 5);
    feedAll(g, coop);
    expect(feedAll(g, coop)).toBe(0);
    expect(g.count('feed')).toBe(4);
  });
});

describe('production and collection', () => {
  it('a fed chicken lays an egg after 3 min of game time', () => {
    const g = new Game(winterState());
    const coop = pen(g, 'coop');
    buyAnimal(g, coop, 'chicken');
    buyFeed(g);
    feedAll(g, coop);
    const hen = coop.state.animals[0];
    wait(g, 179_000);
    expect(animalStatus(g.state.clock, hen)).toBe('producing');
    expect(collect(g, coop)).toEqual({});
    wait(g, 1_000);
    expect(animalStatus(g.state.clock, hen)).toBe('ready');
    expect(readyCount(g.state.clock, coop)).toBe(1);
    expect(collect(g, coop)).toEqual({ egg: 1 });
    expect(g.count('egg')).toBe(1);
    // Hungry again, and a second collect gives nothing.
    expect(animalStatus(g.state.clock, hen)).toBe('hungry');
    expect(collect(g, coop)).toEqual({});
    expect(g.count('egg')).toBe(1);
  });

  it('a cow eats 2 feed and gives milk after 6 min; a sheep eats 1 and gives wool after 8 min', () => {
    const g = new Game(winterState());
    g.earn(10_000);
    const pasture = pen(g, 'pasture');
    buyAnimal(g, pasture, 'cow');
    buyAnimal(g, pasture, 'sheep');
    g.addItem('feed', 3);
    feedAll(g, pasture);
    expect(g.count('feed')).toBe(0);
    wait(g, 360_000);
    expect(collect(g, pasture)).toEqual({ milk: 1 });
    wait(g, 120_000);
    expect(collect(g, pasture)).toEqual({ wool: 1 });
    // The milk went into the family's meal when the new day began.
    expect(familiesOf(g.state).lastDay?.ate).toEqual({ milk: 1 });
    expect(g.count('milk')).toBe(0);
    expect(g.count('wool')).toBe(1);
  });

  it('the clock speed shortens the real wait', () => {
    const g = new Game(winterState());
    const coop = pen(g, 'coop');
    buyAnimal(g, coop, 'chicken');
    g.addItem('feed', 1);
    feedAll(g, coop);
    g.setSpeed(300);
    for (let i = 0; i < 4; i++) g.tick(200); // 800 ms real = 240 s game
    expect(collect(g, coop)).toEqual({ egg: 1 });
  });
});

describe('saving', () => {
  it('keeps animals, hunger and cycle progress across a reload', () => {
    const g = new Game(winterState());
    g.earn(10_000);
    const coop = pen(g, 'coop');
    buyAnimal(g, coop, 'chicken');
    buyAnimal(g, coop, 'chicken');
    g.addItem('feed', 1);
    feedAll(g, coop);
    wait(g, 150_000);

    const g2 = new Game(deserialize(serialize(g.state)));
    const loaded = g2.getObject(coop.id) as PlacedObject<PenState>;
    expect(loaded.state.animals.map((a) => animalStatus(g2.state.clock, a))).toEqual(['producing', 'hungry']);
    wait(g2, 30_000);
    expect(collect(g2, loaded)).toEqual({ egg: 1 });
  });

  it('drops malformed animals from a save', () => {
    const g = new Game(winterState());
    const coop = pen(g, 'coop');
    coop.state.animals = [{ kind: 'dragon', timer: null }, { kind: 'chicken', timer: 'soon' }] as never;
    expect(animalsOf(coop)).toEqual([{ kind: 'chicken', timer: null, hungrySince: null }]);
  });
});

describe('winter feeding and starving', () => {
  const YEAR = 4 * SEASON_MS;

  /** A coop with 6 chickens and a pasture with 4 cows, nobody to feed them and no feed: they starve in winter. */
  function hungryFarm() {
    const g = new Game(maxLevelState());
    g.earn(10_000);
    const coop = pen(g, 'coop');
    const pasture = pen(g, 'pasture', ox + 4, oy);
    for (let i = 0; i < 6; i++) buyAnimal(g, coop, 'chicken');
    for (let i = 0; i < 4; i++) buyAnimal(g, pasture, 'cow');
    const starved: { at: number; pen: string; kind: string }[] = [];
    g.activity.on('starved', ({ pen: id, kind }) => starved.push({ at: g.now, pen: id, kind }));
    return { g, coop, pasture, starved };
  }

  it('animals graze from spring to autumn: a cycle takes no feed and the feed count stays as it is', () => {
    for (const season of [0, 1, 2]) {
      const g = new Game(maxLevelState());
      g.state.clock.elapsed = season * SEASON_MS + 1000;
      const coop = pen(g, 'coop');
      buyAnimal(g, coop, 'chicken');
      g.addItem('feed', 3);
      expect(feedNeeded(g, coop)).toBe(0);
      expect(feedAll(g, coop)).toBe(1);
      expect(g.count('feed')).toBe(3);
      expect(animalStatus(g.state.clock, coop.state.animals[0])).toBe('producing');
    }
  });

  it('with no feed in winter a farm loses one animal per pen per day, and none in other seasons', () => {
    const { g, coop, pasture, starved } = hungryFarm();
    g.advance(3 * SEASON_MS);
    // Spring to autumn: hungry all along, but grazing time, so nobody starves.
    expect(starved).toEqual([]);
    expect(starvingAnimals(g)).toHaveLength(10);
    g.advance(SEASON_MS);
    // Each of the 4 winter days ends with one death in each pen, at the day boundary.
    expect(starved).toHaveLength(8);
    const days = [13, 14, 15, 16].map((d) => d * DAY_MS);
    for (const id of [coop.id, pasture.id]) expect(starved.filter((s) => s.pen === id).map((s) => s.at)).toEqual(days);
    expect(animalsOf(coop)).toHaveLength(2);
    expect(animalsOf(pasture)).toHaveLength(0);
    // Spring again: the last two chickens live on.
    g.advance(3 * SEASON_MS);
    expect(starved).toHaveLength(8);
    expect(animalsOf(coop)).toHaveLength(2);
  });

  it('feed in stock saves them, and so does a cycle under way', () => {
    const { g, coop, pasture, starved } = hungryFarm();
    g.state.clock.elapsed = 3 * SEASON_MS;
    g.addItem('feed', 2);
    // Two cows' worth of feed: no one in the coop or the pasture starves while it lasts (nobody feeds them, so it does).
    g.advance(SEASON_MS);
    expect(starved).toEqual([]);
    expect(animalsOf(coop)).toHaveLength(6);
    expect(animalsOf(pasture)).toHaveLength(4);
  });

  it('×1, ×60, offline catch-up and a reload give the same deaths', () => {
    const outcome = (g: Game) => JSON.stringify(g.state.objects.map((o) => o.state));
    const live = hungryFarm();
    for (let t = 0; t < YEAR; t += 1000) live.g.advance(1000);
    const fast = hungryFarm();
    for (let t = 0; t < YEAR; t += 60_000) fast.g.advance(60_000);
    const away = hungryFarm();
    catchUp(away.g, YEAR);
    let reloaded = hungryFarm().g;
    reloaded.advance(3 * SEASON_MS + DAY_MS + 12_345);
    reloaded = new Game(deserialize(serialize(reloaded.state)));
    reloaded.advance(YEAR - reloaded.now);
    expect(live.starved).toHaveLength(8);
    for (const g of [fast.g, away.g, reloaded]) expect(outcome(g)).toBe(outcome(live.g));
    expect(fast.starved).toEqual(live.starved);
    expect(away.starved).toEqual(live.starved);
  });

  it("a winter's need: each animal's feed per cycle × the cycles it runs in a winter", () => {
    const g = new Game(maxLevelState());
    g.earn(10_000);
    const coop = pen(g, 'coop');
    const pasture = pen(g, 'pasture', ox + 4, oy);
    buyAnimal(g, coop, 'chicken');
    buyAnimal(g, pasture, 'cow');
    buyAnimal(g, pasture, 'sheep');
    // A winter is 32 min: a chicken lays 11 times (3 min), a cow milks 6 times (6 min, 2 feed), a sheep 4 times (8 min).
    expect(winterFeedNeed(g.state)).toBe(11 + 12 + 4);
  });

  it('an old save loads with its animals cycles as they were, hungry ones counted from the load, and a reload changes nothing', () => {
    const g = new Game(winterState());
    g.earn(10_000);
    const coop = pen(g, 'coop');
    buyAnimal(g, coop, 'chicken');
    buyAnimal(g, coop, 'chicken');
    g.addItem('feed', 1);
    feedAll(g, coop);
    const timer = coop.state.animals[0].timer;
    const raw = JSON.parse(serialize(g.state));
    raw.version = 18;
    for (const a of raw.state.objects.find((o: { id: string }) => o.id === coop.id).state.animals) delete a.hungrySince;
    const loaded = parseSave(JSON.stringify(raw)).state;
    const animals = (loaded.objects.find((o) => o.id === coop.id)!.state as PenState).animals;
    expect(animals).toEqual([
      { kind: 'chicken', timer, hungrySince: null },
      { kind: 'chicken', timer: null, hungrySince: g.now },
    ]);
    expect(deserialize(serialize(loaded))).toEqual(loaded);
  });
});
