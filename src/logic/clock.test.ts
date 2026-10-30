import { describe, expect, it } from 'vitest';
import { advance, createClock, dayOf, MAX_FRAME_MS, startTimer, timerDone, timerProgress, timerRemaining, timeOfDay } from './clock';
import { DAY_MS } from './constants';

describe('clock', () => {
  it('a day lasts 4 real minutes at x1', () => {
    expect(DAY_MS).toBe(240_000);
    const c = createClock();
    expect(dayOf(c)).toBe(1);
    for (let i = 0; i < 240_000 / 16; i++) advance(c, 16);
    expect(dayOf(c)).toBe(2);
    expect(timeOfDay(c)).toBeCloseTo(0);
  });

  it('the speed multiplier scales game time', () => {
    const c = createClock();
    c.speed = 10;
    expect(advance(c, 100)).toBe(1000);
    expect(c.elapsed).toBe(1000);
  });

  it('clamps huge frame deltas so a stalled tab does not fast-forward', () => {
    const c = createClock();
    expect(advance(c, 60_000)).toBe(MAX_FRAME_MS);
  });

  it('ignores zero, negative and NaN deltas', () => {
    const c = createClock();
    advance(c, 0);
    advance(c, -5);
    advance(c, Number.NaN);
    expect(c.elapsed).toBe(0);
  });

  it('timers run on game time and speed up with the clock', () => {
    const c = createClock();
    const t = startTimer(c, 10_000);
    advance(c, 100);
    expect(timerProgress(c, t)).toBeCloseTo(0.01);
    c.speed = 60;
    advance(c, 100); // +6000 game ms
    expect(timerProgress(c, t)).toBeCloseTo(0.61);
    expect(timerRemaining(c, t)).toBe(3900);
    expect(timerDone(c, t)).toBe(false);
    advance(c, 100);
    expect(timerDone(c, t)).toBe(true);
    expect(timerProgress(c, t)).toBe(1);
  });
});
