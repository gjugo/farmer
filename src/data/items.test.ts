import { describe, expect, it } from 'vitest';
import { splitIcons } from './items';

describe('splitIcons', () => {
  it('turns item emoji into icon parts', () => {
    expect(splitIcons('+3 🥚 Egg')).toEqual(['+3 ', { icon: 'egg', emoji: '🥚' }, ' Egg']);
  });

  it('leaves an item emoji alone when it is part of a joined emoji (👨‍🌾 holds 🌾)', () => {
    expect(splitIcons('👨‍🌾 Farmers')).toEqual(['👨‍🌾 Farmers']);
    expect(splitIcons('🌾 Wheat')).toEqual([{ icon: 'wheat', emoji: '🌾' }, ' Wheat']);
  });
});
