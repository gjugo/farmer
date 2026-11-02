import { describe, expect, it } from 'vitest';
// Every module that registers a buildable (the Game pulls them all in).
import '../logic/game';
import { BUILD_CATEGORIES, listBuildCategory, listBuildMenu } from './buildables';

describe('construction menu categories', () => {
  it('puts every build-menu buildable except the path in exactly one category', () => {
    const menu = listBuildMenu();
    expect(menu.length).toBeGreaterThan(20);
    for (const b of menu) {
      const homes = BUILD_CATEGORIES.filter((c) => listBuildCategory(c.id).includes(b));
      expect(homes.map((c) => c.id), b.id).toHaveLength(b.id === 'path' ? 0 : 1);
    }
  });

  it('lists a category in unlock order', () => {
    expect(listBuildCategory('storage').map((b) => b.id)).toEqual(['granary', 'storehouse', 'trading-post', 'oxbarn']);
    expect(listBuildCategory('resources').map((b) => b.id)).toEqual(['woodcutter', 'quarry', 'mine']);
    for (const c of BUILD_CATEGORIES) {
      const levels = listBuildCategory(c.id).map((b) => b.unlockLevel ?? 1);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
    }
  });
});
