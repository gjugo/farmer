import { describe, expect, it } from 'vitest';
import { SEASONS } from '../../data/seasons';
import { isIdentity, isNaturalChange, JUMP_MS, SEASON_LOOK, WEATHER_CAP, weatherBudget } from './look';
import { loadWeatherSettings, saveWeatherSettings, WEATHER_SETTINGS_KEY } from './settings';

describe('season look', () => {
  it('cools winter and warms autumn, and leaves spring as drawn', () => {
    expect(SEASON_LOOK.spring.grade).toBeNull();
    const [r, g, b] = [0, 6, 12].map((i) => SEASON_LOOK.winter.grade![i]);
    expect(b).toBeGreaterThan(r);
    expect(g).toBeLessThanOrEqual(b);
    const autumn = SEASON_LOOK.autumn.grade!;
    expect(autumn[0]).toBeGreaterThan(autumn[12]);
    for (const season of SEASONS) {
      expect(SEASON_LOOK[season].background).toMatch(/^#[0-9a-f]{6}$/);
      const grade = SEASON_LOOK[season].grade;
      if (grade) {
        expect(grade).toHaveLength(20);
        expect(isIdentity(grade)).toBe(false);
      }
    }
    expect(new Set(SEASONS.map((s) => SEASON_LOOK[s].background)).size).toBe(4);
  });
});

describe('weather budget', () => {
  it('is clear in summer and when weather effects are off', () => {
    expect(weatherBudget('summer', 1280, 800, 1, true)).toBe(0);
    for (const season of SEASONS) expect(weatherBudget(season, 1280, 800, 1, false)).toBe(0);
  });

  it('snows hardest in winter, leaves fall in autumn, a few petals in spring', () => {
    const at = (s: (typeof SEASONS)[number]) => weatherBudget(s, 1280, 800, 1, true);
    expect(at('winter')).toBeGreaterThan(at('autumn'));
    expect(at('autumn')).toBeGreaterThan(at('spring'));
    expect(at('spring')).toBeGreaterThan(0);
  });

  it('never goes over the cap, even on a huge screen', () => {
    expect(WEATHER_CAP).toBeLessThanOrEqual(150);
    for (const season of SEASONS) expect(weatherBudget(season, 3840, 2160, 2, true)).toBeLessThanOrEqual(WEATHER_CAP);
    expect(weatherBudget('winter', 3840, 2160, 2, true)).toBe(WEATHER_CAP);
  });

  it('thins out when zoomed far out', () => {
    expect(weatherBudget('winter', 1280, 800, 0.2, true)).toBeLessThan(weatherBudget('winter', 1280, 800, 1, true) / 2);
    expect(weatherBudget('winter', 1280, 800, 0.2, true)).toBeGreaterThan(0);
  });

  it('still snows properly on a phone', () => {
    expect(weatherBudget('winter', 390, 844, 1, true)).toBeGreaterThanOrEqual(50);
  });
});

describe('season change', () => {
  it('crossfades when the clock runs on, switches at once on a jump or a new game', () => {
    expect(isNaturalChange(1000, 1016)).toBe(true);
    expect(isNaturalChange(1000, 1000 + 16 * 300)).toBe(true); // ×300
    expect(isNaturalChange(1000, 1000 + JUMP_MS + 1)).toBe(false); // debug "Next season", time away
    expect(isNaturalChange(5_000_000, 0)).toBe(false); // New game
  });
});

describe('weather settings', () => {
  const memory = (init: Record<string, string> = {}) => {
    const data = new Map(Object.entries(init));
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  };

  it('is on by default, off by default with reduced motion', () => {
    expect(loadWeatherSettings(memory(), false)).toEqual({ enabled: true });
    expect(loadWeatherSettings(memory(), true)).toEqual({ enabled: false });
    expect(loadWeatherSettings(null, true)).toEqual({ enabled: false });
  });

  it('keeps the player’s choice over the default', () => {
    const storage = memory();
    saveWeatherSettings(storage, { enabled: true });
    expect(storage.data.get(WEATHER_SETTINGS_KEY)).toBe('{"enabled":true}');
    expect(loadWeatherSettings(storage, true)).toEqual({ enabled: true });
    saveWeatherSettings(storage, { enabled: false });
    expect(loadWeatherSettings(storage, false)).toEqual({ enabled: false });
  });

  it('falls back to the default on broken data', () => {
    expect(loadWeatherSettings(memory({ [WEATHER_SETTINGS_KEY]: '{oops' }), false)).toEqual({ enabled: true });
    expect(loadWeatherSettings(memory({ [WEATHER_SETTINGS_KEY]: '{"enabled":"yes"}' }), true)).toEqual({ enabled: false });
  });
});
