import Phaser from 'phaser';
import { CAMP, CAMP_FADE_MS, CAMP_SUPPLIES } from '../../data/camp';
import { getItem } from '../../data/items';
import type { ObjectView, PanelLine } from '../../game/context';
import { onGameStart, registerBehavior, registerDebugInfo } from '../../game/hooks';
import { campInfo, campLeft, campSlice, tentFamilies, waitingFamilies, type CampState } from '../../logic/camp';
import { villageCentre } from '../../logic/roads';
import { seasonOf } from '../../logic/seasons';
import { ART_RES, ART_SCALE, artFor } from '../../scenes/art';
import { packAsset } from '../../scenes/sprites';

/**
 * The starting camp (rules: src/logic/camp.ts): the tent and its campfire, the supply piles in front of it (drawn with
 * the stock piles, see src/features/storage/piles.ts), its panel, smoke from the fire on winter days, and the fade and
 * toast when it is packed away. `window.farm.camp` is `{ id, left, room, packed, families, waiting }` (the families in the
 * tent, and how many of them wait for homes once the supplies are used up), or null on saves from before it.
 */

/** Where the smoke rises: over the cooking pot, in 2x pixels of the `camp` sprite. */
const FIRE_AT = { x: 433, y: 300 };
const PUFFS = 3;
const PACKED_MESSAGE = 'Your camp is packed away: the starting supplies are used up and its families have moved into their homes';

const puffsOf = new Map<string, Phaser.GameObjects.Image[]>();

/** "Waiting for homes for 2 families": the empty tent can't be packed away until they have cottage room. */
export function waitingLine(n: number): string {
  return `Waiting for homes for ${n} ${n === 1 ? 'family' : 'families'}`;
}

/** "32 🪵 · 20 🪨 · 12 🍞 · 15 🥕", in the order the supplies are listed; what has run out drops off. */
export function suppliesLine(left: Record<string, number>): string {
  return Object.keys(CAMP_SUPPLIES)
    .filter((id) => (left[id] ?? 0) > 0)
    .map((id) => `${left[id]} ${getItem(id)?.icon ?? id}`)
    .join(' · ');
}

registerBehavior<CampState>(CAMP, {
  create: (ctx, obj, view: ObjectView) => {
    const [ax, ay] = packAsset(artFor(CAMP))?.res[ART_RES].anchor ?? [0, 0];
    const at = { x: view.top.x + (FIRE_AT.x - ax) * ART_SCALE, y: view.top.y + (FIRE_AT.y - ay) * ART_SCALE };
    const puffs = Array.from({ length: PUFFS }, () => ctx.scene.add.image(at.x, at.y, 'proc-smoke').setVisible(false).setData('at', at));
    view.container.add(puffs);
    puffsOf.set(obj.id, puffs);
  },
  update: (ctx, obj) => {
    const puffs = puffsOf.get(obj.id);
    if (!puffs) return;
    const on = seasonOf(ctx.game.state.clock) === 'winter';
    // Cosmetic only, so it runs on real time.
    const t = ctx.scene.time.now;
    puffs.forEach((p, i) => {
      p.setVisible(on);
      if (!on) return;
      const a = p.getData('at') as { x: number; y: number };
      const phase = (t / 2200 + i / PUFFS) % 1;
      p.setPosition(a.x + Math.sin(phase * 5 + i) * 6 + phase * 8, a.y - phase * 46);
      p.setAlpha(0.65 * (1 - phase));
      p.setScale(0.5 + phase * 0.8);
    });
  },
  destroy: (ctx, obj, view) => {
    puffsOf.delete(obj.id);
    // Packed away (not a new game or a load): the tent fades out where it stood.
    const s = campSlice(ctx.game.state);
    if (!s.packed || s.id !== obj.id) return;
    const { sprite, container } = view;
    const ghost = ctx.scene.add
      .image(container.x + sprite.x, container.y + sprite.y, sprite.texture.key)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setDepth(container.depth);
    ctx.scene.tweens.add({ targets: ghost, alpha: 0, duration: CAMP_FADE_MS, ease: 'Sine.easeIn', onComplete: () => ghost.destroy() });
  },
  panel: (ctx, obj) => {
    const { state } = ctx.game;
    const left = campLeft(obj);
    const families = tentFamilies(state);
    const empty = Object.keys(left).length === 0;
    const waiting = empty ? waitingFamilies(state) : 0;
    const lines: PanelLine[] = [
      { text: empty ? 'Starting supplies: all used up' : `Starting supplies: ${suppliesLine(left)} left`, testId: 'camp-supplies' },
      ...(families > 0
        ? [
            {
              text: `Home of ${families} ${families === 1 ? 'family' : 'families'}: ${
                villageCentre(state)?.type === CAMP ? 'they set out from in front of the tent until the farmhouse is built.' : 'they set out from the farmhouse door.'
              }`,
              testId: 'camp-families',
            },
          ]
        : []),
      ...(waiting > 0 ? [{ text: `${waitingLine(waiting)}: build 🛖 cottages so they can move out.`, testId: 'camp-waiting' }] : []),
      {
        text: 'The settlers’ supplies are stored here and used first. The camp is packed away once they are used up and its families have room in the cottages.',
        testId: 'camp-note',
      },
    ];
    return { title: 'Camp', icon: '⛺', lines };
  },
});

onGameStart((ctx) => {
  const { game } = ctx;
  // The camp is never demolished and a new game or load replaces the state without removing objects: removed means packed.
  const unsubscribe = game.events.on('objectRemoved', (obj) => {
    if (obj.type === CAMP) ctx.ui.toast(PACKED_MESSAGE, 'success');
  });
  ctx.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  registerDebugInfo('camp', () => campInfo(game.state));
});
