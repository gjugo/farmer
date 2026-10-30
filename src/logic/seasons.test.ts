import { describe, expect, it } from 'vitest';
import { SEASON_DAYS } from '../data/seasons';
import { DAY_MS } from './constants';
import { dayOfSeason, nextSeasonAt, nextSeasonIn, SEASON_MS, seasonAt, seasonOf, seasonRunEnd } from './seasons';

const clockAt = (elapsed: number) => ({ elapsed, speed: 1 });

describe('seasons', () => {
  it('a season lasts 2 days: days 1–2 spring, 3–4 summer, 5–6 autumn, 7–8 winter, then spring again', () => {
    expect(SEASON_DAYS).toBe(2);
    const byDay = Array.from({ length: 10 }, (_, d) => seasonAt(d * DAY_MS));
    expect(byDay).toEqual(['spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter', 'spring', 'spring']);
    expect(seasonOf(clockAt(0))).toBe('spring');
    expect(seasonOf(clockAt(SEASON_MS - 1))).toBe('spring');
    expect(seasonOf(clockAt(SEASON_MS))).toBe('summer');
  });

  it('counts the day within the season', () => {
    expect(dayOfSeason(clockAt(0))).toBe(1);
    expect(dayOfSeason(clockAt(DAY_MS))).toBe(2);
    expect(dayOfSeason(clockAt(2 * DAY_MS))).toBe(1);
  });

  it('finds the next season change', () => {
    expect(nextSeasonAt(0)).toBe(SEASON_MS);
    expect(nextSeasonAt(SEASON_MS - 1)).toBe(SEASON_MS);
    expect(nextSeasonAt(SEASON_MS)).toBe(2 * SEASON_MS);
  });

  it('finds where a run of seasons ends', () => {
    const growing = ['spring', 'summer', 'autumn'] as const;
    expect(seasonRunEnd(10, growing)).toBe(3 * SEASON_MS); // the winter frost
    expect(seasonRunEnd(2 * SEASON_MS + 5, growing)).toBe(3 * SEASON_MS);
    expect(seasonRunEnd(3 * SEASON_MS + 5, growing)).toBe(3 * SEASON_MS + 5); // in winter: not in the run
    expect(seasonRunEnd(10, ['spring', 'autumn'])).toBe(SEASON_MS);
    expect(seasonRunEnd(10, ['winter', 'spring'])).toBe(SEASON_MS); // wraps around the year
    expect(seasonRunEnd(10, ['spring', 'summer', 'autumn', 'winter'])).toBe(Infinity);
  });

  it('finds when one of a set of seasons is next on', () => {
    expect(nextSeasonIn(10, ['spring'])).toBe(10);
    expect(nextSeasonIn(3 * SEASON_MS + 5, ['spring', 'summer'])).toBe(4 * SEASON_MS);
    expect(nextSeasonIn(10, ['autumn'])).toBe(2 * SEASON_MS);
    expect(nextSeasonIn(10, [])).toBe(Infinity);
  });
});
