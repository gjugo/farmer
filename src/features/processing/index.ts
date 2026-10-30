import type Phaser from 'phaser';
import { getItem } from '../../data/items';
import { PROCESSORS, QUEUE_LIMIT, findRecipe, type ProcessorType, type RecipeDef } from '../../data/processing';
import type { FarmContext, ObjectView, PanelAction, PanelSpec, PlacedObject } from '../../game/context';
import { registerBehavior } from '../../game/hooks';
import { timerRemaining } from '../../logic/clock';
import {
  checkStart,
  collect,
  currentProgress,
  inputsOf,
  isWorking,
  readyCount,
  sanitize,
  settle,
  startJob,
  type ProcessorState,
} from '../../logic/processing';
import { ANIM_ANCHOR } from './textures';

const PUFFS = 3;

interface Decor {
  wheel: Phaser.GameObjects.Image | null;
  puffs: Phaser.GameObjects.Image[];
  bubble: Phaser.GameObjects.Container;
  bubbleIcon: Phaser.GameObjects.Text;
  /** What the bubble currently shows, to skip redundant setText calls. */
  bubbleKey: string;
}

const decor = new Map<string, Decor>();

function itemLabel(itemId: string): string {
  const item = getItem(itemId);
  return item ? `${item.icon} ${item.name}` : itemId;
}

function itemIcon(itemId: string): string {
  return getItem(itemId)?.icon ?? itemId;
}

function formatTime(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const rest = s % 60;
  return rest ? `${Math.floor(s / 60)}m ${rest}s` : `${Math.floor(s / 60)}m`;
}

function outputLabel(recipe: RecipeDef): string {
  return `${recipe.output.qty} ${itemLabel(recipe.output.item)}`;
}

function create(ctx: FarmContext, obj: PlacedObject<ProcessorState>, view: ObjectView): void {
  sanitize(obj, ctx.game.state.clock);
  const scene = ctx.scene;
  const def = PROCESSORS[obj.type as ProcessorType];
  const a = ANIM_ANCHOR[def.id];
  const wheel = def.anim === 'wheel' ? scene.add.image(a.x, a.y, 'proc-wheel') : null;
  const puffs =
    def.anim === 'smoke'
      ? Array.from({ length: PUFFS }, () => scene.add.image(a.x, a.y, 'proc-smoke').setVisible(false))
      : [];
  const bubbleIcon = scene.add
    .text(16, 10, '', { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#2b2118', resolution: 2 })
    .setOrigin(0.5, 0.5);
  const bubble = scene.add
    .container(view.width / 2 - 16, -14, [scene.add.image(0, 0, 'proc-bubble').setOrigin(0), bubbleIcon])
    .setVisible(false);
  view.container.add([...(wheel ? [wheel] : []), ...puffs, bubble]);
  decor.set(obj.id, { wheel, puffs, bubble, bubbleIcon, bubbleKey: '' });
  refresh(ctx, obj);
}

/** Shows the ready-output bubble, e.g. "🧀2", when something waits to be collected. */
function refresh(_ctx: FarmContext, obj: PlacedObject<ProcessorState>): void {
  const d = decor.get(obj.id);
  if (!d) return;
  const entries = Object.entries(obj.state.ready);
  const key = entries.map(([id, n]) => `${itemIcon(id)}${n > 1 ? n : ''}`).join('');
  if (key === d.bubbleKey) return;
  d.bubbleKey = key;
  d.bubble.setVisible(key !== '');
  d.bubbleIcon.setText(entries.length > 1 ? entries.map(([id]) => itemIcon(id)).join('') : key);
}

function animate(ctx: FarmContext, obj: PlacedObject<ProcessorState>, view: ObjectView): void {
  const d = decor.get(obj.id);
  if (!d) return;
  // Cosmetic only, so it runs on real time: debug speed should not make the wheel blur.
  const t = ctx.scene.time.now;
  const working = isWorking(obj);
  if (d.wheel && working) d.wheel.rotation = (t / 900) % (Math.PI * 2);
  const a = ANIM_ANCHOR[obj.type as ProcessorType];
  d.puffs.forEach((p, i) => {
    p.setVisible(working);
    if (!working) return;
    const phase = (t / 1800 + i / PUFFS) % 1;
    p.setPosition(a.x + Math.sin(phase * 5 + i) * 3 + phase * 6, a.y - phase * 22);
    p.setAlpha(0.75 * (1 - phase));
    p.setScale(0.5 + phase * 0.8);
  });
  if (d.bubble.visible) d.bubble.y = -14 + Math.sin(t / 260) * 1.5;
  view.container.bringToTop(d.bubble);
}

function collectAndFloat(ctx: FarmContext, obj: PlacedObject<ProcessorState>): void {
  const got = collect(ctx.game, obj);
  const fp = PROCESSORS[obj.type as ProcessorType].footprint;
  Object.entries(got).forEach(([itemId, n], i) => {
    ctx.ui.floatText(obj.x + (fp.w - 1) / 2, obj.y - i * 0.6, `+${n} ${itemLabel(itemId)}`);
  });
}

function panel(ctx: FarmContext, obj: PlacedObject<ProcessorState>): PanelSpec {
  const { game } = ctx;
  const def = PROCESSORS[obj.type as ProcessorType];
  const clock = game.state.clock;
  const { queue, ready } = obj.state;

  const lines = [`Queue: ${queue.length} / ${QUEUE_LIMIT}`];
  if (queue.length === 0) lines.push('Idle. Pick a recipe below to start a job.');
  queue.forEach((job, i) => {
    const recipe = findRecipe(obj.type, job.recipe);
    if (recipe) lines.push(`${i + 1}. ${outputLabel(recipe)} — ${i === 0 ? 'working' : 'waiting'}`);
  });
  const readyText = Object.entries(ready).map(([id, n]) => `${n} ${itemLabel(id)}`);
  if (readyText.length) lines.push(`Ready to collect: ${readyText.join(', ')}`);

  const actions: PanelAction[] = [];
  if (readyCount(obj) > 0) actions.push({ label: `Collect ${readyText.join(', ')}`, onClick: () => collectAndFloat(ctx, obj) });
  for (const recipe of def.recipes) {
    const inputs = inputsOf(recipe)
      .map(([id, need]) => `${itemIcon(id)} ${game.count(id)}/${need}`)
      .join(' + ');
    actions.push({
      label: `Make ${outputLabel(recipe)} · ${inputs} · ${formatTime(recipe.durationMs)}`,
      variant: 'secondary',
      disabled: !checkStart(game, obj, recipe.id).ok,
      onClick: () => {
        const r = startJob(game, obj, recipe.id);
        if (!r.ok) ctx.ui.toast(r.reason === 'queue-full' ? 'The queue is full' : 'Not enough ingredients', 'error');
      },
    });
  }

  const head = queue[0];
  const headRecipe = head && findRecipe(obj.type, head.recipe);
  const progress = currentProgress(clock, obj);
  return {
    title: def.name,
    icon: def.icon,
    lines,
    progress:
      progress !== null && head?.timer && headRecipe
        ? {
            value: progress,
            label: `${itemLabel(headRecipe.output.item)} · ${formatTime(timerRemaining(clock, head.timer))} left`,
          }
        : undefined,
    actions,
  };
}

for (const type of Object.keys(PROCESSORS) as ProcessorType[]) {
  registerBehavior<ProcessorState>(type, {
    create,
    refresh,
    update(ctx, obj, view) {
      const finished = settle(ctx.game.state.clock, obj);
      if (finished > 0) {
        ctx.game.touch(obj);
        ctx.game.activity.emit('jobsFinished', { count: finished });
      }
      animate(ctx, obj, view);
    },
    destroy(_ctx, obj) {
      decor.delete(obj.id); // the display objects go with the view's container
    },
    // Clicking a building with output waiting collects it; otherwise the panel opens.
    onClick(ctx, obj) {
      if (readyCount(obj) === 0) return false;
      collectAndFloat(ctx, obj);
      return true;
    },
    panel,
  });
}
