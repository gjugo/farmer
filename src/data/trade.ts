import { registerBuildable } from './buildables';

/**
 * The trading post: trade (the ⚖️ Market, Orders and the travelling trader) needs one, finished and linked to the
 * main road by the farm's own paths. Rules live in `src/logic/tradepost.ts`, its look and panel in `src/features/trade`.
 */
export const TRADING_POST = 'trading-post';

registerBuildable({
  id: TRADING_POST,
  name: 'Trading Post',
  cost: 60,
  materials: { wood: 10 },
  footprint: { w: 2, h: 2 },
  texture: 'trading-post',
  category: 'storage',
  icon: '🏪',
  unlockLevel: 1,
  description: 'Where merchants trade. Link it to the 🛣️ main road with a path from the farmhouse to open the ⚖️ Market, Orders and the trader. One is enough.',
});
