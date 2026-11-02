import Phaser from 'phaser';
import { getItem } from '../../data/items';
import { CART_CAPACITY, OX_BARN, OX_MS_PER_TILE, OX_PRICE } from '../../data/haul';
import type { FarmContext, PanelAction, PanelSpec, PlacedObject } from '../../game/context';
import { onGameStart, registerBehavior, registerDebugInfo } from '../../game/hooks';
import { placeName } from '../../game/workers';
import type { Game } from '../../logic/game';
import { barnState, barnWait, buyOx, cartPose, cartsOf, isBarn, parkedPose, sanitizeBarn, tripsOf, units, type BarnState, type BarnWait, type CartPose } from '../../logic/haul';
import type { Inventory } from '../../logic/types';
import { cartArt, cartLoadArt, facing, OX_ART, type Facing } from '../../scenes/art';
import { walkerDepth } from '../../scenes/depth';
import { gridToWorld } from '../../scenes/iso';
import { addArt, addArtSprite } from '../../scenes/sprites';
import { formatMoney } from '../../ui/dom';
import { isDebugMode } from '../../ui/debug';

/**
 * The ox barn and its oxcart on the map: an ox pulling the cart along the paths, its carter walking beside it (drawn
 * by `src/features/workers`), and the load on the cart, logs, stone, iron or sacks. Rules live in `src/logic/haul.ts`.
 */

/** "🪵 Wood" */
function itemLabel(id: string): string {
  const item = getItem(id);
  return item ? `${item.icon} ${item.name}` : id;
}

/** "12 🪵 Wood, 3 🪨 Stone" */
function goodsLabel(inv: Inventory): string {
  return Object.entries(inv).map(([id, n]) => `${n} ${itemLabel(id)}`).join(', ');
}

const WAIT_TEXT: Record<BarnWait['wait'], (game: Game, to?: string) => string> = {
  'no-ox': () => `No ox: buy one to pull the cart (${formatMoney(OX_PRICE)}).`,
  'no-carter': () => 'No carter: assign a farmer to drive the cart.',
  'nothing-to-haul': () => 'Nothing to haul: no yard or workshop has goods waiting.',
  'stores-full': () => 'Stores full: build or upgrade a granary or storehouse, or sell something.',
  'no-path': (game, to) => {
    const obj = to ? game.getObject(to) : undefined;
    return `No path to ${obj ? placeName(game, obj) : 'the stores'}: lay one so the cart can drive there.`;
  },
};

/** What the barn's cart is doing, for the panel. */
function tripLine(game: Game, barn: PlacedObject): string | null {
  const found = tripsOf(game.state).find(({ trip }) => trip.barn === barn.id && !trip.parked);
  if (!found) return null;
  const { trip } = found;
  const pose = cartPose(trip, barn, game.now);
  const name = (id: string | null) => {
    const obj = id ? game.getObject(id) : undefined;
    return obj ? placeName(game, obj) : '…';
  };
  const load = units(trip.load) > 0 ? ` with ${goodsLabel(trip.load)}` : '';
  if (!pose || pose.leg === 'parked') return `🐂 The carter is walking to the barn: next stop ${name(trip.from ?? trip.to)}.`;
  if (pose.leg === 'load') return `🐂 Loading at ${name(trip.from)}.`;
  if (pose.leg === 'unload') return `🐂 Unloading ${goodsLabel(trip.load)} at ${name(trip.to)}.`;
  const going = trip.unloaded ? 'back to the barn' : `to ${name(trip.loaded ? trip.to : trip.from)}`;
  return `🐂 Driving ${going}${load}.`;
}

function panel(ctx: FarmContext, barn: PlacedObject<BarnState>): PanelSpec {
  const { game } = ctx;
  const s = barnState(barn);
  const lines = [
    `An oxcart carries up to ${CART_CAPACITY} goods at a time from the fullest yard or workshop to the nearest store with room, at ${OX_MS_PER_TILE / 1000} s a tile.`,
    s.ox ? '🐂 Ox: yes' : `🐂 Ox: none yet (${formatMoney(OX_PRICE)})`,
  ];
  if (units(s.cargo) > 0) lines.push(`On the parked cart: ${goodsLabel(s.cargo)}`);
  const trip = tripLine(game, barn);
  if (trip) lines.push(trip);
  const wait = barnWait(game, barn);
  if (wait) lines.push(`⏸ ${WAIT_TEXT[wait.wait](game, wait.to)}`);
  const actions: PanelAction[] = [];
  if (!s.ox) {
    actions.push({
      label: `🐂 Buy an ox (${formatMoney(OX_PRICE)})`,
      disabled: !game.canAfford(OX_PRICE),
      onClick: () => {
        const r = buyOx(game, barn);
        ctx.ui.toast(r.ok ? 'An ox moved into the barn' : `An ox costs ${formatMoney(OX_PRICE)}`, r.ok ? 'success' : 'error');
      },
    });
    if (isDebugMode()) actions.push({ label: '🐞 Free ox (debug)', variant: 'secondary', onClick: () => buyOx(game, barn, true) });
  }
  return { title: 'Ox Barn', icon: '🐂', lines, actions };
}

registerBehavior<BarnState>(OX_BARN, {
  create(_ctx, obj) {
    sanitizeBarn(obj);
  },
  panel,
});

/** The current game, for the debug info. */
let current: Game | null = null;

/** `window.farm.carts`, for QA: every barn's cart, `[{ barn, farmer, leg, at, load, from, to }]`. */
registerDebugInfo('carts', () => (current ? structuredClone(cartsOf(current.state)) : null));

// The carts on the map ------------------------------------------------------------------

/** The ox stands this far ahead of the cart's middle, along the way it heads (tiles). */
const OX_AHEAD = 0.55;
const CART_BACK = 0.2;
/** Where the load sits on the cart's bed, in world px from the cart's anchor, per facing. */
const LOAD_AT: Record<Facing, { x: number; y: number }> = { se: { x: 0, y: -14 }, sw: { x: 0, y: -14 }, ne: { x: 0, y: -14 }, nw: { x: 0, y: -14 } };

interface CartSprites {
  ox: Phaser.GameObjects.Sprite;
  cart: Phaser.GameObjects.Image;
  load: Phaser.GameObjects.Image;
  loadArt: string | null;
}

function addCart(scene: Phaser.Scene): CartSprites {
  return {
    ox: addArtSprite(scene, 0, 0, OX_ART),
    cart: addArt(scene, 0, 0, cartArt('se')),
    load: addArt(scene, 0, 0, cartArt('se')).setVisible(false),
    loadArt: null,
  };
}

function destroyCart(c: CartSprites): void {
  c.ox.destroy();
  c.cart.destroy();
  c.load.destroy();
}

/** The unit vector of `d` (east when it has no length). */
function unit(d: { x: number; y: number }): { x: number; y: number } {
  const n = Math.hypot(d.x, d.y);
  return n > 0 ? { x: d.x / n, y: d.y / n } : { x: 1, y: 0 };
}

function drawCart(scene: Phaser.Scene, c: CartSprites, pose: CartPose, load: Inventory): void {
  const dir = unit(pose.dir);
  const face = facing(dir.x, dir.y);
  const cartAt = { x: pose.at.x - dir.x * CART_BACK, y: pose.at.y - dir.y * CART_BACK };
  const oxAt = { x: pose.at.x + dir.x * OX_AHEAD, y: pose.at.y + dir.y * OX_AHEAD };
  // Cart (and pile) art stands on the middle of a tile; the ox's anchor is the ground under it.
  const cp = gridToWorld(cartAt.x - 0.5, cartAt.y - 0.5);
  const op = gridToWorld(oxAt.x, oxAt.y);
  // The rig sorts as one thing standing at the cart's middle: the ox in front of the cart when heading towards the
  // viewer (se, sw), behind it when heading away.
  const depth = walkerDepth(pose.at.x, pose.at.y);
  const oxFirst = dir.x + dir.y > 0;
  c.cart.setTexture(scene.textures.exists(cartArt(face)) ? cartArt(face) : 'missing').setPosition(cp.x, cp.y).setDepth(depth + (oxFirst ? 0 : 2e-6));
  c.ox.setPosition(op.x, op.y).setDepth(depth + (oxFirst ? 2e-6 : 0));
  const anim = `${OX_ART}_${pose.leg === 'drive' ? 'walk' : 'idle'}_${face}`;
  if (scene.anims.exists(anim)) c.ox.play(anim, true);
  // The load sits on the cart's bed, just above it.
  const art = cartLoadArt(load);
  if (art !== c.loadArt) {
    c.loadArt = art;
    c.load.setVisible(!!art);
    if (art) c.load.setTexture(scene.textures.exists(art) ? art : 'missing');
  }
  if (art) c.load.setPosition(cp.x + LOAD_AT[face].x, cp.y + LOAD_AT[face].y).setDepth(c.cart.depth + 1e-6);
}

onGameStart((ctx) => {
  current = ctx.game;
  const scene = ctx.scene;
  const carts = new Map<string, CartSprites>();
  const onUpdate = () => {
    const { game } = ctx;
    const now = game.now;
    const trips = new Map(tripsOf(game.state, true).filter(({ trip }) => !trip.parked).map(({ trip }) => [trip.barn, trip]));
    const seen = new Set<string>();
    for (const barn of game.state.objects) {
      if (!isBarn(barn) || barn.site || !(barn.state as BarnState).ox) continue;
      seen.add(barn.id);
      let c = carts.get(barn.id);
      if (!c) carts.set(barn.id, (c = addCart(scene)));
      const trip = trips.get(barn.id);
      const pose = (trip && cartPose(trip, barn, now)) ?? parkedPose(barn);
      drawCart(scene, c, pose, trip ? trip.load : (barn.state as BarnState).cargo);
    }
    for (const [id, c] of carts) {
      if (seen.has(id)) continue;
      destroyCart(c);
      carts.delete(id);
    }
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    carts.forEach(destroyCart);
    carts.clear();
  });
});
