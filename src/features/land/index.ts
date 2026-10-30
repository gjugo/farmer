import Phaser from 'phaser';
import type { FarmContext } from '../../game/context';
import { onGameStart, registerTileTapHandler } from '../../game/hooks';
import { START_LAND } from '../../logic/constants';
import { isOwned } from '../../logic/land';
import type { LandState } from '../../logic/types';
import { buyParcel, checkBuy, FARM_PARCELS, parcelAt, parcelsForSale, type Parcel } from '../../logic/parcels';
import { registerTexture, TILE } from '../../scenes/textures';
import { formatMoney } from '../../ui/dom';

/**
 * Farm expansion: locked parcels next to owned land show a "For sale" sign.
 * Tapping a for-sale parcel opens a buy dialog (see `src/logic/parcels.ts`).
 */

const SIGN_W = 52;
const SIGN_H = 44;
const SIGN_DEPTH = 5;

registerTexture('sale-sign', {
  width: SIGN_W,
  height: SIGN_H,
  draw: (g) => {
    // Post
    g.fillStyle(0x6b4423).fillRect(SIGN_W / 2 - 3, 18, 6, SIGN_H - 18);
    // Board with a darker rim; "FOR SALE" is written on it as text.
    g.fillStyle(0x7a4e26).fillRoundedRect(1, 1, SIGN_W - 2, 24, 4);
    g.fillStyle(0xf3e2b8).fillRoundedRect(4, 4, SIGN_W - 8, 18, 3);
  },
});

const BUY_ERRORS = {
  owned: 'You already own this land',
  'not-adjacent': 'Buy the land next to it first',
  money: 'Not enough money',
} as const;

function check(ctx: FarmContext, parcel: Parcel) {
  return checkBuy(ctx.game.state.land, FARM_PARCELS, START_LAND, parcel, ctx.game.money);
}

async function openBuyDialog(ctx: FarmContext, parcel: Parcel): Promise<void> {
  const { game, ui } = ctx;
  const first = check(ctx, parcel);
  const short = first.price - game.money;
  const ok = await ui.confirm(
    `Buy this land for ${formatMoney(first.price)}?`,
    `A ${parcel.w}×${parcel.h} plot you can build on right away. You have ${formatMoney(game.money)}.`,
    {
      confirmLabel: `Buy for ${formatMoney(first.price)}`,
      variant: 'primary',
      disabled: !first.ok,
      hint: !first.ok && first.reason === 'money' ? `You need ${formatMoney(short)} more — sell goods at the Market.` : undefined,
    },
  );
  if (!ok) return;
  const result = buyParcel(game, FARM_PARCELS, START_LAND, parcel);
  if (!result.ok) {
    ui.toast(BUY_ERRORS[result.reason], 'error');
    return;
  }
  ui.toast('New land! Build on it right away.', 'success');
  ui.floatText(parcel.x + (parcel.w - 1) / 2, parcel.y + parcel.h / 2, `-${formatMoney(result.price)}`, '#ffd6a0');
}

/**
 * Where a parcel's sign stands (bottom-centre of the post, in world px): just inside
 * the edge it shares with owned land, so it is visible from the farm.
 */
function signSpot(land: LandState, p: Parcel): { x: number; y: number } {
  const along = (n: number, at: (i: number) => boolean) => Array.from({ length: n }, (_, i) => i).some(at);
  const cx = (p.x + p.w / 2) * TILE;
  const cy = (p.y + p.h / 2) * TILE;
  if (along(p.w, (i) => isOwned(land, p.x + i, p.y + p.h))) return { x: cx, y: (p.y + p.h) * TILE - 22 };
  if (along(p.w, (i) => isOwned(land, p.x + i, p.y - 1))) return { x: cx, y: p.y * TILE + SIGN_H };
  if (along(p.h, (i) => isOwned(land, p.x - 1, p.y + i))) return { x: p.x * TILE + 1.5 * TILE, y: cy };
  if (along(p.h, (i) => isOwned(land, p.x + p.w, p.y + i))) return { x: (p.x + p.w) * TILE - 1.5 * TILE, y: cy };
  return { x: cx, y: cy };
}

registerTileTapHandler((ctx, x, y) => {
  const { land } = ctx.game.state;
  if (isOwned(land, x, y)) return false;
  const parcel = parcelAt(FARM_PARCELS, x, y);
  if (!parcel) return false;
  const result = check(ctx, parcel);
  if (!result.ok && result.reason === 'not-adjacent') {
    ctx.ui.toast(BUY_ERRORS['not-adjacent']);
    return false;
  }
  void openBuyDialog(ctx, parcel);
  return true;
});

onGameStart((ctx) => {
  const scene = ctx.scene;
  const layer = scene.add.container(0, 0).setDepth(SIGN_DEPTH);
  let dirty = true;
  const markDirty = () => {
    dirty = true;
  };

  const redraw = () => {
    layer.removeAll(true);
    const { land } = ctx.game.state;
    for (const parcel of parcelsForSale(land, FARM_PARCELS)) {
      const { price } = check(ctx, parcel);
      const { x: cx, y: cy } = signSpot(land, parcel);
      const sign = scene.add.image(cx, cy, 'sale-sign').setOrigin(0.5, 1);
      const label = scene.add
        .text(cx, cy - SIGN_H + 13, 'FOR SALE', { fontFamily: 'system-ui, sans-serif', fontSize: '8px', fontStyle: 'bold', color: '#b23a2e', resolution: 3 })
        .setOrigin(0.5);
      const priceText = scene.add
        .text(cx, cy + 3, formatMoney(price), {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '13px',
          fontStyle: 'bold',
          color: ctx.game.money >= price ? '#ffffff' : '#ffb3a8',
          stroke: '#2b2118',
          strokeThickness: 4,
          resolution: 2,
        })
        .setOrigin(0.5, 0);
      layer.add([sign, label, priceText]);
    }
  };

  const { events } = ctx.game;
  const unsubscribe = [events.on('land', markDirty), events.on('money', markDirty), events.on('reset', markDirty)];
  const onUpdate = () => {
    if (!dirty) return;
    dirty = false;
    redraw();
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    unsubscribe.forEach((u) => u());
  });
});
