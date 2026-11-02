import { describe, expect, it } from 'vitest';
import '../data/animals';
import '../data/resourceBuildings';
import { buyAnimal, type PenState } from '../logic/animals';
import { Game } from '../logic/game';
import { setOwned } from '../logic/land';
import { maxLevelState } from '../logic/test-utils';
import type { PlacedObject } from '../logic/types';
import type { Job } from '../logic/workers';
import { carriedItem, farmerLoad } from './workers';

function farm(): Game {
  const game = new Game(maxLevelState());
  game.earn(1_000_000);
  const land = game.state.land;
  for (let y = 0; y < land.height; y++) for (let x = 0; x < land.width; x++) setOwned(land, x, y, true);
  return game;
}

/** Places `type` (or its construction site) in the first free spot from the map's far corner. */
function place<S extends object = Record<string, unknown>>(game: Game, type: string, site = false): PlacedObject<S> {
  const { width, height } = game.state.land;
  let at: { x: number; y: number } | null = null;
  for (let y = height - 5; y >= 0 && !at; y--) for (let x = width - 5; x >= 0 && !at; x--) if (game.checkPlacement(type, x, y).ok) at = { x, y };
  if (!at) throw new Error(`no room for ${type}`);
  const r = game.place(type, at.x, at.y, { site });
  if (!r.ok) throw new Error(`could not place ${type}: ${r.reason}`);
  return r.object as unknown as PlacedObject<S>;
}

/** A job on `obj` that started now: 10 s out, 20 s of work, 10 s back. `target` false: hand-ordered (no target). */
function job(game: Game, kind: Job['kind'], obj: PlacedObject, target = true): Job {
  const j: Job = { kind, x: obj.x + 0.5, y: obj.y + 0.5, timer: { start: game.state.clock.elapsed, duration: 40_000 }, walkMs: 10_000, route: [] };
  if (target) j.target = obj.id;
  return j;
}

/** The load at `ms` into the job. */
function loadAt(game: Game, j: Job, ms: number) {
  return farmerLoad(game, { ...j, timer: { ...j.timer, start: game.state.clock.elapsed - ms } });
}

describe('what a farmer carries', () => {
  it('brings eggs home from a coop in a basket, and nothing out or while working', () => {
    const game = farm();
    const coop = place<PenState>(game, 'coop');
    buyAnimal(game, coop, 'chicken');
    const j = job(game, 'collect', coop);
    expect(carriedItem(game, j)).toBe('egg');
    expect(loadAt(game, j, 5_000)).toBeNull();
    expect(loadAt(game, j, 20_000)).toBeNull();
    expect(loadAt(game, j, 35_000)).toBe('basket');
  });

  it('brings milk from a pasture with cows in a bucket, and wool from one with only sheep in a sack', () => {
    const game = farm();
    const pasture = place<PenState>(game, 'pasture');
    buyAnimal(game, pasture, 'sheep');
    expect(carriedItem(game, job(game, 'collect', pasture))).toBe('wool');
    expect(loadAt(game, job(game, 'collect', pasture), 35_000)).toBe('sack');
    buyAnimal(game, pasture, 'cow');
    expect(loadAt(game, job(game, 'collect', pasture), 35_000)).toBe('bucket');
  });

  it("brings logs home from the woodcutter's lodge", () => {
    const game = farm();
    const lodge = place(game, 'woodcutter');
    expect(loadAt(game, job(game, 'chop', lodge), 35_000)).toBe('logs');
    expect(loadAt(game, job(game, 'collect', lodge), 35_000)).toBe('logs');
  });

  it('carries wood out to a site that costs wood, stone to one that does not, also when hand-ordered', () => {
    const game = farm();
    const coop = place(game, 'coop', true);
    expect(loadAt(game, job(game, 'build', coop), 5_000)).toBe('logs');
    expect(loadAt(game, job(game, 'build', coop, false), 5_000)).toBe('logs');
    expect(loadAt(game, job(game, 'build', coop), 35_000)).toBeNull();
    const lodge = place(game, 'woodcutter', true);
    expect(loadAt(game, job(game, 'build', lodge), 5_000)).toBe('stone');
  });

  it('walks out with a sack to feed, spread manure and load a batch; harvests come home in a sack', () => {
    const game = farm();
    const coop = place(game, 'coop');
    for (const kind of ['feed', 'fertilise', 'load'] as const) {
      expect(loadAt(game, job(game, kind, coop), 5_000), kind).toBe('sack');
      expect(loadAt(game, job(game, kind, coop), 35_000), kind).toBeNull();
    }
    expect(loadAt(game, job(game, 'harvest', coop), 35_000)).toBe('sack');
    expect(loadAt(game, job(game, 'plough', coop), 5_000)).toBeNull();
    expect(loadAt(game, job(game, 'plant', coop), 35_000)).toBeNull();
  });
});
