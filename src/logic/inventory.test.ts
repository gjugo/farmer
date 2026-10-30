import { describe, expect, it } from 'vitest';
import { add, count, remove } from './inventory';
import type { Inventory } from './types';

describe('inventory', () => {
  it('counts zero for unknown items', () => {
    expect(count({}, 'egg')).toBe(0);
  });

  it('adds items', () => {
    const inv: Inventory = {};
    add(inv, 'egg', 3);
    add(inv, 'egg');
    expect(count(inv, 'egg')).toBe(4);
  });

  it('removes items when enough are held', () => {
    const inv: Inventory = { milk: 5 };
    expect(remove(inv, 'milk', 2)).toBe(true);
    expect(count(inv, 'milk')).toBe(3);
  });

  it('refuses to remove more than held and never goes negative', () => {
    const inv: Inventory = { milk: 1 };
    expect(remove(inv, 'milk', 2)).toBe(false);
    expect(count(inv, 'milk')).toBe(1);
    expect(remove(inv, 'cheese')).toBe(false);
    expect(inv).toEqual({ milk: 1 });
  });

  it('drops the entry when the count reaches zero', () => {
    const inv: Inventory = { wool: 2 };
    expect(remove(inv, 'wool', 2)).toBe(true);
    expect(inv).toEqual({});
  });

  it('rejects negative and fractional quantities', () => {
    const inv: Inventory = { egg: 1 };
    expect(() => add(inv, 'egg', -1)).toThrow(RangeError);
    expect(() => remove(inv, 'egg', -1)).toThrow(RangeError);
    expect(() => add(inv, 'egg', 1.5)).toThrow(RangeError);
    expect(inv).toEqual({ egg: 1 });
  });
});
