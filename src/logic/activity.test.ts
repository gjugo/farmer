import { describe, expect, it } from 'vitest';
import { FIELD } from '../data/crops';
import type { ActivityEvents } from './activity';
import { buyAnimal, feedAll, type PenState } from './animals';
import { START_LAND } from './constants';
import { plant, type FieldState } from './crops';
import { Game } from './game';
import { startJob, type ProcessorState } from './processing';
import { SEASON_MS } from './seasons';
import { maxLevelState } from './test-utils';
import type { PlacedObject } from './types';

/** Records every activity event, in order. */
function record(game: Game): string[] {
  const seen: string[] = [];
  const events: (keyof ActivityEvents)[] = ['planted', 'animalBought', 'fed', 'jobStarted', 'goalClaimed'];
  for (const e of events) game.activity.on(e, () => seen.push(e));
  return seen;
}

/** A max-level farm that has plenty of money. */
function richGame(): Game {
  const game = new Game(maxLevelState());
  game.earn(10_000);
  return game;
}

describe('activity events for actions without a state event', () => {
  it('planting reports `planted` once, and a refused plant reports nothing', () => {
    const game = new Game(maxLevelState());
    const seen = record(game);
    const field = game.objectsOfType(FIELD)[0] as PlacedObject<FieldState>;
    expect(plant(game, field, 'wheat').ok).toBe(true);
    expect(plant(game, field, 'wheat').ok).toBe(false);
    expect(seen).toEqual(['planted']);
  });

  it('buying and feeding animals report `animalBought` and `fed`', () => {
    const game = richGame();
    const seen = record(game);
    const placed = game.place('coop', 0, 0);
    if (!placed.ok) throw new Error(placed.reason);
    const coop = placed.object as PlacedObject<PenState>;
    expect(buyAnimal(game, coop, 'chicken').ok).toBe(true);
    game.state.clock.elapsed = 3 * SEASON_MS; // winter: animals eat feed
    expect(feedAll(game, coop)).toBe(0); // no feed yet
    game.addItem('feed', 5);
    expect(feedAll(game, coop)).toBe(1);
    expect(seen).toEqual(['animalBought', 'fed']);
  });

  it('starting a processing job reports `jobStarted`', () => {
    const game = richGame();
    const seen = record(game);
    const placed = game.place('dairy', 0, 0);
    if (!placed.ok) throw new Error(placed.reason);
    const dairy = placed.object as unknown as PlacedObject<ProcessorState>;
    expect(startJob(game, dairy, 'cheese').ok).toBe(false); // no milk
    game.addItem('milk', 10);
    expect(startJob(game, dairy, 'cheese').ok).toBe(true);
    expect(seen).toEqual(['jobStarted']);
  });

  it('claiming a goal reports `goalClaimed`', () => {
    const game = new Game();
    const seen = record(game);
    game.place(FIELD, START_LAND.x + 1, START_LAND.y + 4);
    expect(game.progression.claim('first-field')).not.toBeNull();
    expect(seen).toEqual(['goalClaimed']);
  });
});
