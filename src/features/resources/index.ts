import type Phaser from 'phaser';
import { getItem } from '../../data/items';
import { RESOURCES, SLOW_SEASONS, type ResourceType } from '../../data/resourceBuildings';
import type { FarmContext, ObjectView, PanelSpec, PlacedObject } from '../../game/context';
import { registerBehavior } from '../../game/hooks';
import { timerRemaining } from '../../logic/clock';
import { formatDuration } from '../../logic/crops';
import { collect, cycleProgress, defOf, idleReason, sanitize, todayYield, type IdleReason, type ResourceState } from '../../logic/resources';
import { fullMessage } from '../../logic/storage';
import { footprintLocal } from '../../scenes/iso';
import { ART_RES, ART_SCALE, artFor } from '../../scenes/art';
import { packAsset, textureKey } from '../../scenes/sprites';
import { registerTexture } from '../../scenes/textures';
import { BUBBLE } from '../processing/textures';

/**
 * Woodcutter's lodge, quarry and mine on the map and in their panel: chips or dust fly while a farmer works there,
 * and a bubble shows the output waiting for room in the storehouse. Rules live in `src/logic/resources.ts`, the
 * content in `src/data/resourceBuildings.ts`; the farmers' cycles are run by the work scheduler (`src/logic/work.ts`).
 */

/** Where the work happens in each sprite (grid point on the footprint): the chopping block, the cut blocks, the tunnel. */
const WORK_AT: Record<ResourceType, { x: number; y: number; texture: string }> = {
  woodcutter: { x: 1.25, y: 1.72, texture: 'res-chip' },
  quarry: { x: 1.0, y: 1.45, texture: 'res-dust' },
  mine: { x: 0.8, y: 1.35, texture: 'res-dust' },
};

registerTexture('res-chip', {
  width: 12,
  height: 8,
  draw: (g) => {
    g.fillStyle(0x7a4a24).fillRect(0, 1, 12, 6);
    g.fillStyle(0xe9c48a).fillRect(1, 2, 10, 4);
  },
});

registerTexture('res-dust', {
  width: 24,
  height: 24,
  draw: (g) => {
    g.fillStyle(0xcfc6b4).fillCircle(12, 12, 12);
    g.fillStyle(0xe8e2d4).fillCircle(9, 9, 6);
  },
});

const BITS = 4;
/** Icons in the waiting bubble are this many world pixels tall. */
const BUBBLE_ICON = 28;

interface Decor {
  bits: Phaser.GameObjects.Image[];
  workAt: { x: number; y: number };
  bubble: Phaser.GameObjects.Container;
  bubbleY: number;
  /** What the bubble shows, to skip redundant rebuilds. */
  bubbleKey: string;
}

const decor = new Map<string, Decor>();

/** "4 min" or "5 min 30 s", for cycle lengths. */
function minutes(ms: number): string {
  const s = Math.round(ms / 1000);
  const rest = s % 60;
  return rest ? `${Math.floor(s / 60)} min ${rest} s` : `${s / 60} min`;
}

function itemLabel(itemId: string): string {
  const item = getItem(itemId);
  return item ? `${item.icon} ${item.name}` : itemId;
}

function create(ctx: FarmContext, obj: PlacedObject<ResourceState>, view: ObjectView): void {
  sanitize(obj);
  const scene = ctx.scene;
  const def = defOf(obj);
  const spot = WORK_AT[def.id];
  const local = footprintLocal(def.footprint.w, def.footprint.h, spot.x, spot.y);
  const workAt = { x: local.x, y: local.y - 18 };
  const bits = Array.from({ length: BITS }, () => scene.add.image(workAt.x, workAt.y, spot.texture).setVisible(false));
  // Just above the sprite's top edge.
  const [, ay] = packAsset(artFor(def.id))?.res[ART_RES].anchor ?? [0, 0];
  const bubbleY = view.top.y - ay * ART_SCALE - 4;
  const bubble = scene.add.container(view.top.x, bubbleY, [scene.add.image(0, 0, 'proc-bubble')]).setVisible(false).setName('resource-waiting');
  view.container.add([...bits, bubble]);
  decor.set(obj.id, { bits, workAt, bubble, bubbleY, bubbleKey: '' });
  refresh(ctx, obj);
}

/** Shows the waiting-output bubble, e.g. the wood icon and "4", while output waits for room. */
function refresh(ctx: FarmContext, obj: PlacedObject<ResourceState>): void {
  const d = decor.get(obj.id);
  if (!d) return;
  const n = obj.state.waiting;
  const key = n > 0 ? String(n) : '';
  if (key === d.bubbleKey) return;
  d.bubbleKey = key;
  d.bubble.setVisible(n > 0);
  d.bubble.list.slice(1).forEach((child) => child.destroy());
  if (n === 0) return;
  const scene = ctx.scene;
  const icon = scene.add.image(0, 0, textureKey(scene, defOf(obj).output)).setOrigin(0, 0.5);
  icon.setScale(BUBBLE_ICON / icon.height);
  const label = scene.add
    .text(0, 0, String(n), { fontFamily: 'system-ui, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#2b2118', resolution: 2 })
    .setOrigin(0, 0.5);
  const parts = [icon, label];
  const gap = 2;
  let x = -(icon.displayWidth + gap + label.displayWidth) / 2;
  for (const p of parts) {
    p.setPosition(x, -(BUBBLE.height - (BUBBLE.height - 12) / 2));
    x += p.displayWidth + gap;
  }
  d.bubble.add(parts);
}

/** Chips or dust fly from the work spot while the farmer is at work (not while they are still walking there). */
function animate(ctx: FarmContext, obj: PlacedObject<ResourceState>, view: ObjectView): void {
  const d = decor.get(obj.id);
  if (!d) return;
  // Cosmetic only, so it runs on real time.
  const t = ctx.scene.time.now;
  const { cycle } = obj.state;
  const working = !!cycle && ctx.game.now >= cycle.start;
  const chips = defOf(obj).id === 'woodcutter';
  d.bits.forEach((b, i) => {
    b.setVisible(working);
    if (!working) return;
    const phase = (t / (chips ? 700 : 1600) + i / BITS) % 1;
    const side = i % 2 ? 1 : -1;
    if (chips) {
      // Chips jump out in little arcs and fall back.
      b.setPosition(d.workAt.x + side * phase * 26, d.workAt.y - Math.sin(phase * Math.PI) * 30);
      b.setAngle(phase * 360 * side);
      b.setAlpha(1 - phase * 0.6);
    } else {
      // Dust billows up and fades.
      b.setPosition(d.workAt.x + side * (4 + phase * 18), d.workAt.y - phase * 30);
      b.setScale(0.5 + phase);
      b.setAlpha(0.7 * (1 - phase));
    }
  });
  if (d.bubble.visible) d.bubble.y = d.bubbleY + Math.sin(t / 260) * 2;
  view.container.bringToTop(d.bubble);
}

const IDLE_TEXT: Record<IdleReason, (obj: PlacedObject<ResourceState>) => string> = {
  site: () => 'Still being built',
  'no-farmer': (obj) => `Idle: no farmer works here. Assign one to ${defOf(obj).verb}.`,
  'no-path': () => 'Idle: no path leads here from the farmhouse door.',
  'storehouse-full': () => `Idle: ${fullMessage('materials')}`,
};

function collectAndFloat(ctx: FarmContext, obj: PlacedObject<ResourceState>): void {
  const def = defOf(obj);
  const n = collect(ctx.game, obj);
  if (n > 0) ctx.ui.floatText(obj.x + (def.footprint.w - 1) / 2, obj.y, `+${n} ${itemLabel(def.output)}`);
  if (obj.state.waiting > 0) ctx.ui.toast(`${obj.state.waiting} ${itemLabel(def.output)} wait in the ${def.name.toLowerCase()}. ${fullMessage('materials')}`, 'error');
}

function panel(ctx: FarmContext, obj: PlacedObject<ResourceState>): PanelSpec {
  const { game } = ctx;
  const def = defOf(obj);
  const clock = game.state.clock;
  const out = itemLabel(def.output);
  const winter = Math.round(def.cycleMs * (SLOW_SEASONS.winter ?? 1));
  const lines = [`Makes ${def.yield} ${out} every ${minutes(def.cycleMs)} of work${winter !== def.cycleMs ? ` (${minutes(winter)} in winter)` : ''}.`];
  const idle = idleReason(game, obj);
  if (idle) lines.push(IDLE_TEXT[idle](obj));
  if (obj.state.waiting > 0) lines.push(`Waiting for room in the storehouse: ${obj.state.waiting} ${out}`);
  lines.push(`Made today: ${todayYield(clock, obj)} ${out}`);
  const { cycle } = obj.state;
  const progress = cycleProgress(clock, obj);
  return {
    title: def.name,
    icon: def.icon,
    lines,
    progress:
      cycle && progress !== null
        ? {
            value: progress,
            label: game.now < cycle.start ? 'The farmer is on the way' : `${def.yield} ${out} · ${formatDuration(timerRemaining(clock, cycle))} left`,
          }
        : undefined,
    actions:
      obj.state.waiting > 0
        ? [
            {
              label: `Carry ${obj.state.waiting} ${out} to the storehouse`,
              disabled: game.spaceFor(def.output) === 0,
              onClick: () => collectAndFloat(ctx, obj),
            },
          ]
        : [],
  };
}

for (const type of Object.keys(RESOURCES) as ResourceType[]) {
  registerBehavior<ResourceState>(type, {
    create,
    refresh,
    update(ctx, obj, view) {
      animate(ctx, obj, view);
    },
    destroy(_ctx, obj) {
      decor.delete(obj.id); // the display objects go with the view's container
    },
    // Tapping a building with output waiting carries what fits into the storehouse; otherwise the panel opens.
    onClick(ctx, obj) {
      if (obj.state.waiting === 0 || ctx.game.spaceFor(defOf(obj).output) === 0) return false;
      collectAndFloat(ctx, obj);
      return true;
    },
    panel,
  });
}
