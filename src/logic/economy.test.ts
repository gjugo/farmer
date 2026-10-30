import { describe, expect, it } from 'vitest';
import { canAfford, earn, spend } from './economy';
import { createNewGame } from './state';

describe('economy', () => {
  it('starts a new game with $500', () => {
    expect(createNewGame().money).toBe(500);
  });

  it('canAfford compares against current money', () => {
    const s = createNewGame();
    expect(canAfford(s, 500)).toBe(true);
    expect(canAfford(s, 501)).toBe(false);
  });

  it('spend deducts when affordable', () => {
    const s = createNewGame();
    expect(spend(s, 5)).toBe(true);
    expect(s.money).toBe(495);
  });

  it('spend refuses when short and never goes negative', () => {
    const s = createNewGame();
    s.money = 3;
    expect(spend(s, 5)).toBe(false);
    expect(s.money).toBe(3);
  });

  it('earn adds money', () => {
    const s = createNewGame();
    earn(s, 16);
    expect(s.money).toBe(516);
  });

  it('rejects negative or non-finite amounts', () => {
    const s = createNewGame();
    expect(() => spend(s, -10)).toThrow(RangeError);
    expect(() => earn(s, -10)).toThrow(RangeError);
    expect(() => earn(s, Number.NaN)).toThrow(RangeError);
    expect(s.money).toBe(500);
  });
});
