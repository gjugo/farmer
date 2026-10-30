import { SEASON_DAYS, SEASONS, type Season } from '../data/seasons';
import { DAY_MS } from './constants';
import type { ClockState } from './types';

/**
 * Seasons follow the game clock: day 1–2 spring, 3–4 summer, 5–6 autumn, 7–8 winter, and round again.
 * Nothing is stored: everything seasonal is worked out from game times, so saves, debug speed and
 * offline catch-up need no special cases.
 */

/** Game milliseconds per season. */
export const SEASON_MS = SEASON_DAYS * DAY_MS;

function seasonIndex(time: number): number {
  return Math.floor(Math.max(0, time) / SEASON_MS);
}

/** The season at a game time. */
export function seasonAt(time: number): Season {
  return SEASONS[seasonIndex(time) % SEASONS.length];
}

export function seasonOf(clock: ClockState): Season {
  return seasonAt(clock.elapsed);
}

/** 1-based day within the current season. */
export function dayOfSeason(clock: ClockState): number {
  return Math.floor((Math.max(0, clock.elapsed) % SEASON_MS) / DAY_MS) + 1;
}

/** Game time at which the season after the one at `time` begins. */
export function nextSeasonAt(time: number): number {
  return (seasonIndex(time) + 1) * SEASON_MS;
}

/**
 * Game time at which the run of `seasons` containing `time` ends: the start of the first later season
 * not in the list. `time` itself when it is not in one of them; Infinity when the list covers the year.
 */
export function seasonRunEnd(time: number, seasons: readonly Season[]): number {
  if (!seasons.includes(seasonAt(time))) return time;
  let t = nextSeasonAt(time);
  for (let i = 0; i < SEASONS.length; i++, t += SEASON_MS) if (!seasons.includes(seasonAt(t))) return t;
  return Infinity;
}

/** Game time at which one of `seasons` is next on: `time` itself when it already is; Infinity for an empty list. */
export function nextSeasonIn(time: number, seasons: readonly Season[]): number {
  if (seasons.includes(seasonAt(time))) return time;
  let t = nextSeasonAt(time);
  for (let i = 0; i < SEASONS.length; i++, t += SEASON_MS) if (seasons.includes(seasonAt(t))) return t;
  return Infinity;
}
