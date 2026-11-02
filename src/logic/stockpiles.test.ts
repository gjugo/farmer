import { describe, expect, it } from 'vitest';
import { FARMHOUSE } from '../data/farmhouse';
import '../data/storage';
import './roads'; // gives a new farm its farmhouse
import { HOUSE_PILES, pileStage, stockDisplay, type StockShown } from './stockpiles';
import { createNewGame } from './state';
import { noCamp } from './test-utils';
import { storageInfo } from './storage';
import type { GameState } from './types';

/** A new farm (with its farmhouse, without the camp) holding exactly `inventory`. */
function farm(inventory: Record<string, number> = {}): GameState {
  const state = noCamp(createNewGame());
  state.inventory = { ...inventory };
  return state;
}

let next = 1000;
function add(state: GameState, type: 'granary' | 'storehouse', level = 1, site = false): string {
  const id = `o${next++}`;
  state.objects.push({ id, type, x: 0, y: 0, state: { level }, ...(site ? { site: { workMs: 1000, paid: 0 } } : {}) });
  return id;
}

function byId(shown: StockShown[], id: string): StockShown {
  const s = shown.find((b) => b.id === id);
  if (!s) throw new Error(`${id} not shown`);
  return s;
}

function house(state: GameState, shown: StockShown[]): StockShown {
  return byId(shown, state.objects.find((o) => o.type === FARMHOUSE)!.id);
}

describe('pileStage', () => {
  it('is none when empty, full only when really full, and quarters in between', () => {
    expect(pileStage(0)).toBe(0);
    expect(pileStage(-1)).toBe(0);
    expect(pileStage(Number.NaN)).toBe(0);
    expect(pileStage(0.01)).toBe(1);
    expect(pileStage(0.24)).toBe(1);
    expect(pileStage(0.25)).toBe(2);
    expect(pileStage(0.5)).toBe(3);
    expect(pileStage(0.99)).toBe(3);
    expect(pileStage(1)).toBe(4);
    expect(pileStage(3)).toBe(4);
  });
});

describe('stockDisplay', () => {
  it('shows an empty farm with empty piles everywhere', () => {
    const state = farm();
    const g = add(state, 'granary');
    const s = add(state, 'storehouse');
    const shown = stockDisplay(state);
    expect(house(state, shown).piles).toEqual({ [HOUSE_PILES.goods]: 0, [HOUSE_PILES.materials]: 0 });
    expect(byId(shown, g).piles).toEqual({ crops: 0, animal: 0, feed: 0, goods: 0 });
    expect(byId(shown, s).piles).toEqual({ wood: 0, stone: 0, iron: 0 });
  });

  it('fills the farmhouse store first, then each storage building in placement order up to its room', () => {
    const state = farm({ wood: 30 + 60 + 10 });
    const first = add(state, 'storehouse');
    const second = add(state, 'storehouse');
    const shown = stockDisplay(state);
    expect(house(state, shown).pools.materials).toEqual({ held: 30, capacity: 30 });
    expect(house(state, shown).piles[HOUSE_PILES.materials]).toBe(4);
    expect(byId(shown, first).pools.materials).toEqual({ held: 60, capacity: 60 });
    expect(byId(shown, first).piles.wood).toBe(4);
    expect(byId(shown, second).pools.materials).toEqual({ held: 10, capacity: 60 });
    expect(byId(shown, second).piles.wood).toBe(1);
    expect(byId(shown, second).piles.stone).toBe(0);
  });

  it('leaves the storehouses empty while the farmhouse has room', () => {
    const state = farm({ wood: 20 });
    const s = add(state, 'storehouse');
    const shown = stockDisplay(state);
    expect(house(state, shown).pools.materials?.held).toBe(20);
    expect(byId(shown, s).pools.materials?.held).toBe(0);
    expect(byId(shown, s).piles).toEqual({ wood: 0, stone: 0, iron: 0 });
  });

  it('caps each building at its room, by level; what is over capacity shows nowhere', () => {
    const state = farm({ wheat: 30 + 250 + 500 });
    const g = add(state, 'granary', 2);
    const shown = stockDisplay(state);
    expect(storageInfo(state).goods.used).toBeGreaterThan(storageInfo(state).goods.capacity);
    expect(byId(shown, g).pools.goods).toEqual({ held: 250, capacity: 250 });
    expect(byId(shown, g).piles.crops).toBe(4);
  });

  it('a full building looks full whatever the mix; smaller piles are scaled to the biggest', () => {
    const state = farm({ wood: 60, stone: 30 });
    const s = add(state, 'storehouse');
    const shown = stockDisplay(state);
    // The storehouse holds 60 of 60: wood (the biggest pile, 60) is full, stone (30) is scaled to it.
    expect(byId(shown, s).piles.wood).toBe(4);
    expect(byId(shown, s).piles.stone).toBe(3);
    expect(byId(shown, s).piles.iron).toBe(0);
  });

  it('sorts goods onto category piles at the granary', () => {
    const state = farm({ wheat: 30, carrot: 10, egg: 10, milk: 10, feed: 40, cheese: 20 });
    const g = add(state, 'granary');
    const p = byId(stockDisplay(state), g);
    expect(p.pools.goods).toEqual({ held: 90, capacity: 100 });
    // Biggest pile: feed 40 (the crops pile is 40 too: 30 + 10).
    expect(p.piles).toEqual({ crops: 3, animal: 2, feed: 3, goods: 2 });
  });

  it('skips construction sites and buildings of the other pool', () => {
    const state = farm({ wheat: 50 });
    const site = add(state, 'granary', 1, true);
    add(state, 'storehouse');
    const g = add(state, 'granary');
    const shown = stockDisplay(state);
    expect(shown.some((b) => b.id === site)).toBe(false);
    expect(byId(shown, g).pools.goods?.held).toBe(20);
  });

  it('after a demolish the next building takes its share', () => {
    const state = farm({ stone: 30 + 60 + 30 });
    const first = add(state, 'storehouse');
    const second = add(state, 'storehouse');
    expect(byId(stockDisplay(state), second).pools.materials?.held).toBe(30);
    state.objects = state.objects.filter((o) => o.id !== first);
    const shown = stockDisplay(state);
    expect(shown.some((b) => b.id === first)).toBe(false);
    expect(byId(shown, second).pools.materials?.held).toBe(60);
    expect(byId(shown, second).piles.stone).toBe(4);
  });

  it('counts the farmhouse store first even without a farmhouse on the map', () => {
    const state = farm({ wheat: 40 });
    state.objects = state.objects.filter((o) => o.type !== FARMHOUSE);
    const g = add(state, 'granary');
    expect(byId(stockDisplay(state), g).pools.goods?.held).toBe(10);
  });

  it('lists buildings in placement order', () => {
    const state = farm();
    const a = add(state, 'storehouse');
    const b = add(state, 'granary');
    const ids = stockDisplay(state).map((s) => s.id);
    expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b));
    expect(ids[0]).toBe(state.objects.find((o) => o.type === FARMHOUSE)!.id);
  });
});
