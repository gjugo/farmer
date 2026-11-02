import { getBuildable } from '../data/buildables';
import { TRADING_POST } from '../data/trade';
import { roadTiles } from './mainroad';
import { networkTouches, pathNetwork } from './roads';
import { getSlice, registerStateSlice } from './slices';
import { registerTradeGate } from './tradegate';
import type { GameState, PlacedObject } from './types';

/**
 * The trading post and its link to the main road. Trade is open while a finished trading post is **connected**: the
 * path network from the village centre (the camp's tent, later the farmhouse door; the main road counts as path) reaches both the post and a main-road tile.
 * Breaking the link later closes trade again until it is mended.
 */

/** Why trade is closed: no post yet, its site still being built, no path from the village centre to it, or none on to the road. */
export type TradeLinkReason = 'no-post' | 'building' | 'no-path' | 'no-road';

export interface TradeLink {
  /** The post that is linked, else the first finished one, else the first site; null when there is none. */
  post: PlacedObject | null;
  connected: boolean;
  /** Why it isn't connected; null when it is. */
  reason: TradeLinkReason | null;
}

const cache = new WeakMap<GameState, { sig: string; link: TradeLink }>();

/** Changes whenever objects are placed, demolished or finished, or the road is laid. */
function signature(state: GameState): string {
  const sites = state.objects.reduce((n, o) => n + (o.site ? 1 : 0), 0);
  return `${state.nextObjectId}|${state.objects.length}|${sites}|${roadTiles(state).length}`;
}

function work(state: GameState): TradeLink {
  const posts = state.objects.filter((o) => o.type === TRADING_POST);
  const finished = posts.filter((o) => !o.site);
  if (finished.length === 0) return { post: posts[0] ?? null, connected: false, reason: posts.length ? 'building' : 'no-post' };
  const network = pathNetwork(state);
  const fp = getBuildable(TRADING_POST)!.footprint;
  const reached = finished.find((o) => networkTouches(network, { x: o.x, y: o.y, ...fp }));
  if (!reached) return { post: finished[0], connected: false, reason: 'no-path' };
  const onRoad = roadTiles(state).some((t) => network.has(`${t.x},${t.y}`));
  return onRoad ? { post: reached, connected: true, reason: null } : { post: reached, connected: false, reason: 'no-road' };
}

/** Is a trading post linked to the main road, and if not, why (cached until the farm's objects change). */
export function tradeLink(state: GameState): TradeLink {
  const sig = signature(state);
  const hit = cache.get(state);
  if (hit && hit.sig === sig) return hit.link;
  const link = work(state);
  cache.set(state, { sig, link });
  return link;
}

registerTradeGate((state) => tradeLink(state).connected);

/** Would a trading post with its top-left at (x, y) be linked once finished (for the build ghost)? */
export function wouldLink(state: GameState, x: number, y: number): boolean {
  const network = pathNetwork(state);
  const fp = getBuildable(TRADING_POST)!.footprint;
  return networkTouches(network, { x, y, ...fp }) && roadTiles(state).some((t) => network.has(`${t.x},${t.y}`));
}

/** What each reason tells the player. */
export const LINK_TEXT: Record<TradeLinkReason, string> = {
  'no-post': 'Build a 🏪 trading post and link it to the main road with a path',
  building: 'The 🏪 trading post is still being built',
  'no-path': 'No path from the village (the camp, later the farmhouse) reaches the 🏪 trading post',
  'no-road': 'No path joins the 🏪 trading post to the 🛣️ main road',
};

/** The link line shown by the build ghost, the post's panel and the Trade window. */
export function linkLine(link: TradeLink): string {
  return `🛣️ Linked to the main road ${link.connected ? '✅' : '❌'}`;
}

/** `window.farm.trade`. */
export function tradeInfo(state: GameState) {
  const link = tradeLink(state);
  return { post: link.post ? { id: link.post.id, x: link.post.x, y: link.post.y, site: !!link.post.site } : null, connected: link.connected, reason: link.reason };
}

// The one-time notice for farms from before trade needed a post. -------------------------

export const TRADE_SLICE = 'trade';

export interface TradeNoticeState {
  /** Tell the player once that trade now needs a trading post linked to the main road (set by the save migration). */
  pendingNotice: boolean;
}

registerStateSlice<TradeNoticeState>(TRADE_SLICE, () => ({ pendingNotice: false }));

/** True once, for a farm the migration flagged: the caller shows the notice. */
export function takeTradeNotice(state: GameState): boolean {
  const s = getSlice<TradeNoticeState>(state, TRADE_SLICE);
  if (s.pendingNotice !== true) return false;
  s.pendingNotice = false;
  return true;
}
