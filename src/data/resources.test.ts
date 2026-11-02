import { describe, expect, it } from 'vitest';
import { ITEM_LIST } from './items';
import { isMaterial } from './materials';
import { categoryOf, categoryTotals, getResourceCategory, itemsOf, pileOf, RESOURCE_CATEGORIES } from './resources';
import { poolOf } from '../logic/storage';

describe('resource categories', () => {
  it('lists the five bar categories in order', () => {
    expect(RESOURCE_CATEGORIES.map((c) => c.id)).toEqual(['crops', 'animal', 'feed', 'goods', 'materials']);
  });

  it('puts every catalogue item in exactly one category, in the pool it is stored in', () => {
    const all = RESOURCE_CATEGORIES.flatMap((c) => itemsOf(c.id));
    expect(all.sort()).toEqual(ITEM_LIST.map((i) => i.id).sort());
    for (const item of ITEM_LIST) expect(getResourceCategory(categoryOf(item.id)).pool).toBe(poolOf(item.id));
  });

  it('groups the items as the bar shows them', () => {
    expect(itemsOf('crops')).toEqual(['wheat', 'carrot', 'corn', 'potato', 'barley', 'flax', 'cabbage', 'pumpkin', 'rye', 'apple']);
    expect(itemsOf('animal')).toEqual(['egg', 'milk', 'wool']);
    expect(itemsOf('feed')).toEqual(['feed']);
    expect(itemsOf('goods')).toEqual(['cheese', 'butter', 'flour', 'rye-flour', 'bread', 'rye-bread', 'cloth', 'malt', 'ale', 'linen', 'clothes']);
    expect(itemsOf('materials')).toEqual(['wood', 'stone', 'iron', 'manure', 'tools']);
  });

  it('counts unknown ids (old saves) by their pool', () => {
    expect(categoryOf('mystery')).toBe('goods');
    expect(isMaterial('mystery')).toBe(false);
  });

  it('sums an inventory per category, with every category present', () => {
    expect(categoryTotals({})).toEqual({ crops: 0, animal: 0, feed: 0, goods: 0, materials: 0 });
    expect(categoryTotals({ wheat: 3, corn: 2, milk: 4, feed: 1, bread: 5, cloth: 1, wood: 7, iron: 1 })).toEqual({
      crops: 5,
      animal: 4,
      feed: 1,
      goods: 6,
      materials: 8,
    });
  });

  it('puts goods on their category pile and each material on its own pile', () => {
    expect(pileOf('carrot')).toBe('crops');
    expect(pileOf('wool')).toBe('animal');
    expect(pileOf('feed')).toBe('feed');
    expect(pileOf('cheese')).toBe('goods');
    expect(pileOf('wood')).toBe('wood');
    expect(pileOf('stone')).toBe('stone');
    expect(pileOf('iron')).toBe('iron');
  });
});
