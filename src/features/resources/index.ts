import type Phaser from 'phaser';
import { getItem } from '../../data/items';
import { DEPOSITS, RESOURCES, SLOW_SEASONS, type ResourceType } from '../../data/resourceBuildings';
import type { FarmContext, ObjectView, PanelSpec, PlacedObject } from '../../game/context';
import { registerBehavior } from '../../game/hooks';
import { timerRemaining } from '../../logic/clock';
import { formatDuration } from '../../logic/crops';
import { mapOf, treeStatus, treesInRange } from '../../logic/maplayer';
import { areaOf, collect, cycleProgress, cycleYield, defOf, depositOf, idleReason, nextTreeAt, sanitize, todayYield, yardCapacity, type IdleReason, type ResourceState } from '../../logic/resources';
import type { GameState } from '../../logic/types';
import { fullMessage } from '../../logic/storage';
import { footprintLocal } from '../../scenes/iso';
import { pileArt, PILE_ART_STAGES } from '../../scenes/art';
import { addArt, textureKey } from '../../scenes/sprites';
import { registerTexture } from '../../scenes/textures';

/**
 * Woodcutter's lodge, quarry and mine on the map and in their panel: chips or dust fly while a farmer works there,
 * and the output in the yard lies in a pile at the building (logs, stone or iron, bigger as the yard fills). Rules live in `src/logic/resources.ts`, the
 * content in `src/data/resourceBuildings.ts`; the farmers' cycles are run by the work scheduler (`src/logic/work.ts`).
 */

/** Where the work happens in each Ludo.ai sprite (grid point on the footprint): the chopping block, the rock face, the tunnel mouth. */
const WORK_AT: Record<ResourceType, { x: number; y: number; texture: string }> = {
  woodcutter: { x: 0.95, y: 1.43, texture: 'res-chip' },
  quarry: { x: 1.17, y: 0.71, texture: 'res-dust' },
  mine: { x: 0.65, y: 0.95, texture: 'res-dust' },
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

/** Where the yard's pile lies, a grid point on the footprint: on open ground at the front, clear of the work spot. */
const YARD_AT: Record<ResourceType, { x: number; y: number }> = {
  woodcutter: { x: 1.55, y: 1.6 },
  quarry: { x: 0.45, y: 1.55 },
  mine: { x: 1.55, y: 1.55 },
};

const BITS = 4;

interface Decor {
  bits: Phaser.GameObjects.Image[];
  workAt: { x: number; y: number };
  pile: Phaser.GameObjects.Image;
  /** The pile sprite shown (null: none), to skip redundant changes. */
  pileArt: string | null;
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
  const at = YARD_AT[def.id];
  // Pile art stands on the middle of a tile (see "Stock piles" in tools/ludo/README.md).
  const p = footprintLocal(def.footprint.w, def.footprint.h, at.x - 0.5, at.y - 0.5);
  const pile = addArt(scene, p.x, p.y, pileArt(def.output, 1)!).setVisible(false).setName('resource-yard');
  view.container.add([pile, ...bits]);
  decor.set(obj.id, { bits, workAt, pile, pileArt: null });
  refresh(ctx, obj);
}

/** The pile of the yard's output: a quarter-full pile per quarter of the yard (the smallest one for anything at all). */
export function yardPileArt(state: Pick<GameState, 'ext'>, obj: PlacedObject<ResourceState>): string | null {
  const n = obj.state.waiting;
  if (n <= 0) return null;
  const stage = Math.min(PILE_ART_STAGES, Math.max(1, Math.ceil((n / yardCapacity(state, defOf(obj))) * PILE_ART_STAGES)));
  return pileArt(defOf(obj).output, stage);
}

/** Shows the yard's pile at its fill stage. */
function refresh(ctx: FarmContext, obj: PlacedObject<ResourceState>): void {
  const d = decor.get(obj.id);
  if (!d) return;
  const art = yardPileArt(ctx.game.state, obj);
  if (art === d.pileArt) return;
  d.pileArt = art;
  d.pile.setVisible(!!art);
  if (art) d.pile.setTexture(textureKey(ctx.scene, art));
}

/** Chips or dust fly from the work spot while the farmer is at work (not while they are still walking there). */
function animate(ctx: FarmContext, obj: PlacedObject<ResourceState>): void {
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
}

const IDLE_TEXT: Record<IdleReason, (obj: PlacedObject<ResourceState>, ctx: FarmContext) => string> = {
  site: () => 'Still being built',
  'no-trees': (obj, ctx) => {
    const next = nextTreeAt(ctx.game, obj);
    return `Idle: no grown tree within ${defOf(obj).range} tiles.${next === null ? ' Build it nearer a forest.' : ` The next one grows back in ${formatDuration(next - ctx.game.now)}.`}`;
  },
  exhausted: (obj) => `Deposit used up: no more ${defOf(obj).output} here. Demolish it, or buy ${defOf(obj).output} at the Market.`,
  'no-farmer': (obj) => `Idle: no farmer works here. Assign one to ${defOf(obj).verb}.`,
  'no-path': () => 'Idle: no path leads here from the farmhouse door.',
  'storehouse-full': () => `Idle: the yard is full. ${fullMessage('materials')}`,
};

function collectAndFloat(ctx: FarmContext, obj: PlacedObject<ResourceState>): void {
  const def = defOf(obj);
  const n = collect(ctx.game, obj);
  if (n > 0) ctx.ui.floatText(obj.x + (def.footprint.w - 1) / 2, obj.y, `+${n} ${itemLabel(def.output)}`);
  if (obj.state.waiting > 0) ctx.ui.toast(`${obj.state.waiting} ${itemLabel(def.output)} wait in the yard. ${fullMessage('materials')}`, 'error');
}

/** What the building works: the trees in its reach, or what is left in its deposit. */
function sourceLines(ctx: FarmContext, obj: PlacedObject<ResourceState>): string[] {
  const def = defOf(obj);
  const layer = mapOf(ctx.game.state);
  if (def.range) {
    const trees = treesInRange(layer, areaOf(obj), def.range);
    const stumps = trees.filter((t) => treeStatus(t, ctx.game.now) === 'stump').length;
    return [`🌲 Trees within ${def.range} tiles: ${trees.length - stumps} grown${stumps ? `, ${stumps} stumps growing back` : ''}.`];
  }
  if (def.deposit) {
    const deposit = depositOf(ctx.game, obj);
    const name = DEPOSITS[def.deposit].name;
    return [deposit ? `Left in the ${name}: ${deposit.left} of ${deposit.amount} ${itemLabel(def.output)}` : `The ${name} is used up.`];
  }
  return [];
}

function panel(ctx: FarmContext, obj: PlacedObject<ResourceState>): PanelSpec {
  const { game } = ctx;
  const def = defOf(obj);
  const clock = game.state.clock;
  const out = itemLabel(def.output);
  const winter = Math.round(def.cycleMs * (SLOW_SEASONS.winter ?? 1));
  const lines = [`Makes ${cycleYield(game.state, def)} ${out} every ${minutes(def.cycleMs)} of work${winter !== def.cycleMs ? ` (${minutes(winter)} in winter)` : ''}.`];
  lines.push(...sourceLines(ctx, obj));
  const idle = idleReason(game, obj);
  if (idle) lines.push(IDLE_TEXT[idle](obj, ctx));
  lines.push(`Yard: ${obj.state.waiting} of ${yardCapacity(game.state, def)} ${out}. An ox barn's cart hauls it to the stores; once it is full, the farmer carries it in before working on.`);
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
            label: game.now < cycle.start ? 'The farmer is on the way' : `${cycleYield(game.state, def)} ${out} · ${formatDuration(timerRemaining(clock, cycle))} left`,
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
    update(ctx, obj) {
      animate(ctx, obj);
    },
    destroy(_ctx, obj) {
      decor.delete(obj.id); // the display objects go with the view's container
    },
    panel,
  });
}
