import Phaser from 'phaser';
import type { FarmContext } from '../../game/context';
import { onGameStart, registerTileTapHandler } from '../../game/hooks';
import { START_LAND } from '../../logic/constants';
import { isOwned } from '../../logic/land';
import type { LandState } from '../../logic/types';
import { buyParcel, checkBuy, FARM_PARCELS, parcelAt, parcelsForSale, type Parcel } from '../../logic/parcels';
import { DEPTH } from '../../scenes/depth';
import { gridToWorld, tileToWorld } from '../../scenes/iso';
import { addArt, addShadow } from '../../scenes/sprites';
import { formatMoney } from '../../ui/dom';

/**
 * Farm expansion: locked parcels next to owned land show a "For sale" sign.
 * Tapping a for-sale parcel opens a buy dialog (see `src/logic/parcels.ts`).
 */

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
 * Where a parcel's sign stands: on a tile just inside the edge it shares with owned land, so it is
 * visible from the farm. `front` says whether the parcel lies in front of the farm on screen (higher x
 * or y), which decides whether the sign is drawn over the farm or behind it.
 */
function signSpot(land: LandState, p: Parcel): { x: number; y: number; front: boolean } {
  const along = (n: number, at: (i: number) => boolean) => Array.from({ length: n }, (_, i) => i).some(at);
  const midX = p.x + Math.floor(p.w / 2);
  const midY = p.y + Math.floor(p.h / 2);
  // Behind the farm the sign stands two tiles back, so the fence and front row don't hide it.
  const backX = p.x + p.w - Math.min(2, p.w);
  const backY = p.y + p.h - Math.min(2, p.h);
  if (along(p.w, (i) => isOwned(land, p.x + i, p.y + p.h))) return { x: midX, y: backY, front: false };
  if (along(p.h, (i) => isOwned(land, p.x + p.w, p.y + i))) return { x: backX, y: midY, front: false };
  if (along(p.w, (i) => isOwned(land, p.x + i, p.y - 1))) return { x: midX, y: p.y, front: true };
  if (along(p.h, (i) => isOwned(land, p.x - 1, p.y + i))) return { x: p.x, y: midY, front: true };
  return { x: midX, y: midY, front: true };
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
  const behind = scene.add.container(0, 0).setDepth(DEPTH.behindFarm);
  const inFront = scene.add.container(0, 0).setDepth(DEPTH.frontOfFarm);
  const shadows = scene.add.container(0, 0).setDepth(DEPTH.shadow);
  let dirty = true;
  const markDirty = () => {
    dirty = true;
  };

  const redraw = () => {
    behind.removeAll(true);
    inFront.removeAll(true);
    shadows.removeAll(true);
    const { land } = ctx.game.state;
    for (const parcel of parcelsForSale(land, FARM_PARCELS)) {
      const { price } = check(ctx, parcel);
      const spot = signSpot(land, parcel);
      const top = gridToWorld(spot.x, spot.y);
      const { x: cx, y: cy } = tileToWorld(spot.x, spot.y);
      // The board stands up over other tiles; tapping it means its own tile (see FarmScene.tapTarget).
      const sign = addArt(scene, top.x, top.y, 'sale-sign').setInteractive().setData('tapTile', spot);
      const shadow = addShadow(scene, top.x, top.y, 'sale-sign');
      if (shadow) shadows.add(shadow);
      const priceText = scene.add
        .text(cx, cy + 6, formatMoney(price), {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '24px',
          fontStyle: 'bold',
          color: ctx.game.money >= price ? '#ffffff' : '#ffb3a8',
          stroke: '#2b2118',
          strokeThickness: 6,
          resolution: 2,
        })
        .setOrigin(0.5, 0);
      (spot.front ? inFront : behind).add([sign, priceText]);
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
