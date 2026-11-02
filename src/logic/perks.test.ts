import { describe, expect, it } from 'vitest';
import { ANIMALS } from '../data/animals';
import { CROPS, FIELD } from '../data/crops';
import { ITEM_LIST } from '../data/items';
import { isMaterial } from '../data/materials';
import { PERK_OFFERS, PERKS, type PerkId } from '../data/perks';
import { PROCESSORS } from '../data/processing';
import { RESOURCES } from '../data/resourceBuildings';
import { STORAGE } from '../data/storage';
import { buildWorkMs } from '../data/workers';
import { buyAnimal, feedAll, type PenState } from './animals';
import { DAY_MS, START_LAND } from './constants';
import { harvest, harvestYield, plant, type FieldState } from './crops';
import { addFamily, approvalOf, familiesOf, type DayNeeds } from './families';
import { Game } from './game';
import { setOwned } from './land';
import { buyPrice, dailyPrice, sell, sellPrice } from './market';
import { catchUp } from './offline';
import { choosePerk, initPerks, offerFor, perkFactor, perksOf, queueChoice, resetPerks } from './perks';
import { startJob, type ProcessorState } from './processing';
import { PROGRESSION, type ProgressionState } from './progression';
import { settle as settleResource, type ResourceState } from './resources';
import { parseSave, serialize } from './save';
import { SEASON_MS } from './seasons';
import { getSlice } from './slices';
import { createNewGame } from './state';
import { capacity } from './storage';
import { bareMap, maxLevelState } from './test-utils';
import type { GameState, PlacedObject } from './types';
import { xpForLevel } from './unlocks';
import { walkMs } from './workers';

/** Gives the farm a perk outright (as if chosen at some level). */
function give(state: GameState, id: PerkId, level = 2 + perksOf(state).taken.length): void {
  perksOf(state).taken.push({ level, id });
}

/** A top-level farm owning the whole map, with plenty of money and materials. */
function farm(): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  return game;
}

/** A level-1 farm with a fixed seed. */
function seeded(seed = 1234): GameState {
  const state = createNewGame();
  perksOf(state).seed = seed;
  return state;
}

describe('perk offers', () => {
  it('the same farm and level always give the same three cards, also after a save and load', () => {
    const state = seeded();
    const ids = (s: GameState, level: number) => offerFor(s, level).map((p) => p.id);
    for (let level = 2; level <= 10; level++) {
      expect(ids(state, level)).toHaveLength(PERK_OFFERS);
      expect(ids(state, level)).toEqual(ids(state, level));
      expect(ids(parseSave(serialize(state)).state, level)).toEqual(ids(state, level));
    }
    const levels = Array.from({ length: 9 }, (_, i) => ids(state, i + 2).join());
    expect(new Set(levels).size).toBeGreaterThan(1);
    const seeds = Array.from({ length: 10 }, (_, i) => ids(seeded(i), 2).join());
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('never offers a perk already taken, nor the same perk twice', () => {
    const state = seeded(99);
    // Every subject on the farm: the whole pool can be offered.
    for (const type of ['coop', 'dairy', 'woodcutter']) state.objects.push({ id: `o${type}`, type, x: 0, y: 0, state: {} });
    for (let level = 2; level <= 10; level++) {
      queueChoice(state, level);
      const offer = offerFor(state, level);
      expect(new Set(offer.map((p) => p.id)).size).toBe(offer.length);
      const taken = new Set(perksOf(state).taken.map((t) => t.id));
      expect(offer.some((p) => taken.has(p.id))).toBe(false);
      expect(choosePerk(state, level, offer[0].id).ok).toBe(true);
    }
    expect(new Set(perksOf(state).taken.map((t) => t.id)).size).toBe(9);
    expect(perksOf(state).pending).toEqual([]);
  });

  it('a perk about animals, processing or resources is only offered once the farm has one of them', () => {
    const gated: PerkId[] = ['husbandry', 'quick-hands', 'prospector'];
    for (let seed = 0; seed < 40; seed++) {
      const state = seeded(seed);
      for (let level = 2; level <= 10; level++) expect(offerFor(state, level).some((p) => gated.includes(p.id))).toBe(false);
    }
    // With a coop, Husbandry turns up in some farm's offers; the other cards of that level stay where they were.
    let seen = false;
    for (let seed = 0; seed < 40 && !seen; seed++) {
      const state = seeded(seed);
      const before = offerFor(state, 2).map((p) => p.id);
      state.objects.push({ id: 'o99', type: 'coop', x: 0, y: 0, state: {} });
      const after = offerFor(state, 2).map((p) => p.id);
      if (after.includes('husbandry')) {
        seen = true;
        expect(after.filter((id) => id !== 'husbandry').every((id) => before.includes(id))).toBe(true);
      } else expect(after).toEqual(before);
    }
    expect(seen).toBe(true);
  });

  it('choosing takes only one of the cards of an open choice', () => {
    const state = seeded();
    queueChoice(state, 2);
    const offered = offerFor(state, 2).map((p) => p.id);
    const other = PERKS.find((p) => !offered.includes(p.id))!.id;
    expect(choosePerk(state, 2, other)).toEqual({ ok: false, reason: 'not-offered' });
    expect(choosePerk(state, 3, offered[0])).toEqual({ ok: false, reason: 'not-pending' });
    expect(choosePerk(state, 2, offered[1])).toMatchObject({ ok: true, perk: { id: offered[1] } });
    expect(perksOf(state)).toMatchObject({ taken: [{ level: 2, id: offered[1] }], pending: [] });
    expect(choosePerk(state, 2, offered[0])).toEqual({ ok: false, reason: 'not-pending' });
  });
});

describe('perk choices', () => {
  it('every level-up from 2 opens a choice; several stack, oldest first', () => {
    const game = new Game();
    expect(game.perks.pending).toEqual([]);
    expect(perksOf(game.state).seed).not.toBeNull();
    const events: number[][] = [];
    game.events.on('perks', (p) => events.push([...p.pending]));
    game.progression.setLevel(4);
    expect(game.perks.pending).toEqual([2, 3, 4]);
    expect(events.at(-1)).toEqual([2, 3, 4]);
    const card = game.perks.offer(3)[0];
    expect(game.perks.choose(3, card.id).ok).toBe(true);
    expect(game.perks.pending).toEqual([2, 4]);
    expect(game.perks.taken).toEqual([{ level: 3, id: card.id }]);
  });

  it('a save from before perks gets one open choice per level it has reached', () => {
    const state = createNewGame();
    getSlice<ProgressionState>(state, PROGRESSION).xp = xpForLevel(5);
    delete state.ext.perks;
    const old = JSON.parse(serialize(state));
    const loaded = parseSave(JSON.stringify(old)).state;
    const game = new Game(loaded);
    expect(game.perks.pending).toEqual([2, 3, 4, 5]);
    expect(game.perks.taken).toEqual([]);
    // Reloading keeps them (and the seed), and does not add more.
    const again = new Game(parseSave(serialize(game.state)).state);
    expect(again.perks.pending).toEqual([2, 3, 4, 5]);
    expect(perksOf(again.state).seed).toBe(perksOf(game.state).seed);
    // A level-1 farm has nothing to choose.
    expect(new Game(createNewGame()).perks.pending).toEqual([]);
  });

  it('initPerks leaves a set-up farm alone, and the debug reset reopens every level', () => {
    const state = seeded(7);
    initPerks(state, 6);
    expect(perksOf(state).pending).toEqual([]);
    queueChoice(state, 2);
    give(state, 'thrifty', 2);
    perksOf(state).pending = [];
    resetPerks(state, 4);
    expect(perksOf(state)).toEqual({ seed: 7, taken: [], pending: [2, 3, 4] });
  });

  it('repairs a malformed slice', () => {
    const state = seeded(5);
    state.ext.perks = { seed: 5, taken: [{ level: 2, id: 'haggler' }, { level: 2, id: 'thrifty' }, { level: 3, id: 'nope' }, 'x'], pending: [4, 2, 4, 1, 11, 'a'] };
    expect(perksOf(state)).toEqual({ seed: 5, taken: [{ level: 2, id: 'haggler' }], pending: [4] });
  });
});

describe('perk effects', () => {
  it('without perks every factor is neutral', () => {
    const state = createNewGame();
    for (const p of PERKS) expect(perkFactor(state, p.id)).toBe(p.neutral);
  });

  it('Green thumb: harvests yield 15% more', () => {
    const yieldOf = (perk: boolean) => {
      const game = farm();
      if (perk) give(game.state, 'green-thumb');
      const field = game.objectsOfType(FIELD)[0] as PlacedObject<FieldState>;
      field.state.fertility = 100;
      plant(game, field, 'wheat');
      game.state.clock.elapsed += CROPS.wheat.growMs;
      const expected = harvestYield(game.state, field);
      const r = harvest(game, field);
      expect(r).toMatchObject({ ok: true, qty: expected });
      return expected;
    };
    expect(yieldOf(false)).toBe(13); // 10 × 1.25
    expect(yieldOf(true)).toBe(14); // 10 × 1.15 × 1.25 = 14.4
  });

  it('Rich soil: a harvest drains the soil 30% less', () => {
    const drained = (perk: boolean) => {
      const game = farm();
      if (perk) give(game.state, 'rich-soil');
      const field = game.objectsOfType(FIELD)[0] as PlacedObject<FieldState>;
      field.state.fertility = 100;
      field.state.lastCrop = null;
      plant(game, field, 'corn');
      game.state.clock.elapsed += CROPS.corn.growMs;
      harvest(game, field);
      return 100 - (field.state.fertility as number);
    };
    expect(drained(false)).toBeCloseTo(CROPS.corn.soilDrain);
    expect(drained(true)).toBeCloseTo(CROPS.corn.soilDrain * 0.7);
  });

  it('Good boots: farmers walk 25% faster', () => {
    const route = { tiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], work: { x: 3.5, y: 0.5 } };
    const state = createNewGame();
    const plain = walkMs(route, perkFactor(state, 'good-boots'));
    give(state, 'good-boots');
    expect(walkMs(route, perkFactor(state, 'good-boots'))).toBe(Math.round(plain / 1.25));
  });

  it('Haggler: goods sell for 10% more, materials for the same', () => {
    const game = farm();
    game.state.inventory = { cheese: 2, wood: 2 };
    give(game.state, 'haggler');
    const cheese = dailyPrice(game.day, 'cheese')!;
    expect(sell(game, 'cheese', 1)).toBe(Math.round(cheese * 1.1));
    expect(sell(game, 'wood', 1)).toBe(dailyPrice(game.day, 'wood'));
  });

  it('Haggler never makes selling worth as much as buying', () => {
    for (let day = 1; day <= 200; day++) {
      for (const item of ITEM_LIST) {
        const buy = buyPrice(day, item.id);
        const boosted = sellPrice(day, item.id, 1.1)!;
        if (isMaterial(item.id)) expect(boosted).toBe(dailyPrice(day, item.id));
        if (buy !== null) expect(buy).toBeGreaterThan(boosted);
      }
    }
    // Even a far bigger bonus stays below the buy price.
    for (let day = 1; day <= 50; day++) for (const item of ITEM_LIST) {
      const buy = buyPrice(day, item.id);
      if (buy !== null) expect(buy).toBeGreaterThan(sellPrice(day, item.id, 3)!);
    }
  });

  it('Husbandry: animals produce 20% faster', () => {
    const cycle = (perk: boolean) => {
      const game = farm();
      if (perk) give(game.state, 'husbandry');
      const r = game.place('coop', START_LAND.x, START_LAND.y + 8);
      if (!r.ok) throw new Error(r.reason);
      const coop = r.object as PlacedObject<PenState>;
      expect(buyAnimal(game, coop, 'chicken').ok).toBe(true);
      game.addItem('feed', 5);
      feedAll(game, coop);
      return coop.state.animals[0].timer!.duration;
    };
    expect(cycle(false)).toBe(ANIMALS.chicken.cycleMs);
    expect(cycle(true)).toBe(Math.round(ANIMALS.chicken.cycleMs / 1.2));
  });

  it('Master builder: building work is 30% faster', () => {
    const work = (perk: boolean) => {
      const game = farm();
      if (perk) give(game.state, 'master-builder');
      const r = game.place('cottage', START_LAND.x, START_LAND.y + 8, { site: true });
      if (!r.ok) throw new Error(r.reason);
      return r.object.site!.workMs;
    };
    expect(work(false)).toBe(buildWorkMs('cottage'));
    expect(work(true)).toBe(Math.round(buildWorkMs('cottage') / 1.3));
  });

  it('Big barns: granaries and storehouses hold 20% more (the farmhouse store does not grow)', () => {
    const game = farm();
    const r = game.place('granary', START_LAND.x, START_LAND.y + 8);
    if (!r.ok) throw new Error(r.reason);
    const before = capacity(game.state, 'goods');
    give(game.state, 'big-barns');
    expect(capacity(game.state, 'goods')).toBe(before + STORAGE.granary.levels[0].capacity * 0.2);
  });

  it('Thrifty: buildings need 20% fewer materials, rounded up, at least 1', () => {
    const game = farm();
    give(game.state, 'thrifty');
    expect(game.materialsFor('cottage')).toEqual({ wood: 7 }); // 8 × 0.8 = 6.4
    expect(game.materialsFor('dairy')).toEqual({ wood: 5, stone: 7, iron: 2 }); // 6, 8, 2 → 4.8, 6.4, 1.6
    game.state.inventory = { wood: 20 }; // room in the storehouses for the refund
    const wood = game.count('wood');
    const r = game.place('cottage', START_LAND.x, START_LAND.y + 8);
    expect(r.ok).toBe(true);
    expect(game.count('wood')).toBe(wood - 7);
    // An unfinished site gives back what was paid, no more.
    const site = game.place('cottage', START_LAND.x + 3, START_LAND.y + 8, { site: true });
    if (!site.ok) throw new Error(site.reason);
    game.demolish(site.object.id);
    expect(game.count('wood')).toBe(wood - 7);
  });

  it('Warm hearths: homes burn half the firewood in winter', () => {
    const burnt = (perk: boolean) => {
      const game = farm();
      if (perk) give(game.state, 'warm-hearths');
      // Four families in four homes: the farmhouse and three cottages.
      for (let i = 0; i < 3; i++) {
        expect(game.place('cottage', START_LAND.x + 3 * i, START_LAND.y + 8).ok).toBe(true);
        expect(addFamily(game)).toBe(true);
      }
      game.state.inventory = { wood: 10, wheat: 100 };
      game.state.clock.elapsed = 3 * SEASON_MS - 1;
      familiesOf(game.state).settledDay = Math.floor(game.now / DAY_MS);
      game.advance(1); // the first day of winter
      expect(familiesOf(game.state).lastDay).toMatchObject({ firewood: 4, firewoodNeeded: 4 });
      return 10 - game.count('wood');
    };
    expect(burnt(false)).toBe(4);
    expect(burnt(true)).toBe(2);
  });

  it('Good neighbours: approval +10, shown as its own part of the breakdown', () => {
    const day: DayNeeds = { families: 1, ate: { wheat: 2 }, eaten: 2, meal: 2, variety: 1, firewood: null, firewoodNeeded: 1, clothed: null };
    const plain = approvalOf(day);
    const kind = approvalOf(day, 10);
    expect(kind.approval).toBe(Math.min(100, plain.approval + 10));
    expect(kind.breakdown.at(-1)).toEqual({ id: 'neighbours', label: 'Good neighbours', points: 10 });
    expect(plain.breakdown.some((p) => p.id === 'neighbours')).toBe(false);

    const game = farm();
    give(game.state, 'good-neighbours');
    game.state.inventory = { wheat: 100 };
    game.advance(DAY_MS);
    expect(familiesOf(game.state).breakdown.some((p) => p.id === 'neighbours' && p.points === 10)).toBe(true);
  });

  it('Prospector: lodges, quarries and mines yield 25% more (rounded up)', () => {
    const made = (perk: boolean) => {
      const game = farm();
      game.state.inventory = {};
      if (perk) give(game.state, 'prospector');
      const r = game.place('woodcutter', START_LAND.x, START_LAND.y + 8);
      if (!r.ok) throw new Error(r.reason);
      const lodge = r.object as unknown as PlacedObject<ResourceState>;
      lodge.state.cycle = { start: game.now - 10, duration: 5 };
      return settleResource(game, lodge);
    };
    expect(made(false)).toBe(RESOURCES.woodcutter.yield);
    expect(made(true)).toBe(Math.ceil(RESOURCES.woodcutter.yield * 1.25));
  });

  it('Quick hands: processing batches are 20% faster', () => {
    const batch = (perk: boolean) => {
      const game = farm();
      if (perk) give(game.state, 'quick-hands');
      const r = game.place('dairy', START_LAND.x, START_LAND.y + 8);
      if (!r.ok) throw new Error(r.reason);
      const dairy = r.object as unknown as PlacedObject<ProcessorState>;
      const recipe = PROCESSORS.dairy.recipes[0];
      for (const [item, qty] of Object.entries(recipe.inputs)) game.addItem(item, qty as number);
      expect(startJob(game, dairy, recipe.id).ok).toBe(true);
      return dairy.state.queue[0].timer!.duration;
    };
    const recipe = PROCESSORS.dairy.recipes[0];
    expect(batch(false)).toBe(recipe.durationMs);
    expect(batch(true)).toBe(Math.round(recipe.durationMs / 1.2));
  });

  it('offline catch-up uses the same factors as live play', () => {
    const run = (offline: boolean) => {
      const game = farm();
      give(game.state, 'green-thumb');
      give(game.state, 'good-boots');
      bareMap(game.state);
      game.state.inventory = { wheat: 500 };
      if (offline) catchUp(game, 3 * 3_600_000);
      else for (let i = 0; i < 3 * 60; i++) game.advance(60_000);
      return { inv: game.state.inventory, now: game.now };
    };
    expect(run(true)).toEqual(run(false));
  });
});
