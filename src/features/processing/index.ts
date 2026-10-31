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
import { leftBehindMessage } from '../../logic/storage';
import { ART_RES, ART_SCALE, artFor, MILL, SHADOW } from '../../scenes/art';
import { addArtSprite, packAsset, textureKey } from '../../scenes/sprites';
import { BUBBLE, SMOKE_AT } from './textures';

const PUFFS = 3;
/** Icons in the ready bubble are this many world pixels tall. */
const BUBBLE_ICON = 28;

interface Decor {
  sails: Phaser.GameObjects.Sprite | null;
  puffs: Phaser.GameObjects.Image[];
  /** Where the puffs start (the chimney top), in view pixels. */
  smokeAt: { x: number; y: number };
  bubble: Phaser.GameObjects.Container;
  /** Where the bubble's tip floats, just above the roof (view pixels). */
  bubbleY: number;
  /** What the bubble currently shows, to skip redundant rebuilds. */
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

/** A point given in pixels of the building's 2x sprite, in view pixels. */
function spritePoint(view: ObjectView, art: string, px: number, py: number): { x: number; y: number } {
  const [ax, ay] = packAsset(art)?.res[ART_RES].anchor ?? [0, 0];
  return { x: view.top.x + (px - ax) * ART_SCALE, y: view.top.y + (py - ay) * ART_SCALE };
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
  const art = artFor(def.id);
  let sails: Phaser.GameObjects.Sprite | null = null;
  if (def.anim === 'sails' && scene.textures.exists(MILL.sails)) {
    // The placed mill is the body plus separate sails (same canvas and anchor); the build preview shows the
    // static sprite with the sails baked in.
    view.sprite.setTexture(textureKey(scene, MILL.body));
    view.shadow?.setTexture(textureKey(scene, `${MILL.body}${SHADOW}`));
    sails = addArtSprite(scene, view.top.x, view.top.y, MILL.sails);
    sails.play(MILL.spin);
    view.container.add(sails);
  }
  const smoke = SMOKE_AT[def.id];
  const smokeAt = smoke ? spritePoint(view, art, smoke.x, smoke.y) : view.top;
  const puffs = smoke ? Array.from({ length: PUFFS }, () => scene.add.image(smokeAt.x, smokeAt.y, 'proc-smoke').setVisible(false)) : [];
  const bubbleY = spritePoint(view, view.sprite.texture.key, 0, 0).y - 4;
  const bubble = scene.add
    .container(view.top.x, bubbleY, [scene.add.image(0, 0, 'proc-bubble')])
    .setVisible(false);
  view.container.add([...puffs, bubble]);
  decor.set(obj.id, { sails, puffs, smokeAt, bubble, bubbleY, bubbleKey: '' });
  refresh(ctx, obj);
}

/** Shows the ready-output bubble, e.g. the cheese icon and "2", when something waits to be collected. */
function refresh(ctx: FarmContext, obj: PlacedObject<ProcessorState>): void {
  const d = decor.get(obj.id);
  if (!d) return;
  const entries = Object.entries(obj.state.ready).slice(0, 2);
  const key = entries.map(([id, n]) => `${id}${n}`).join('|');
  if (key === d.bubbleKey) return;
  d.bubbleKey = key;
  d.bubble.setVisible(key !== '');
  d.bubble.list.slice(1).forEach((child) => child.destroy());
  const scene = ctx.scene;
  const parts: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[] = [];
  for (const [id, n] of entries) {
    const icon = scene.add.image(0, 0, textureKey(scene, id)).setOrigin(0, 0.5);
    icon.setScale(BUBBLE_ICON / icon.height);
    parts.push(icon);
    if (n > 1) {
      parts.push(
        scene.add
          .text(0, 0, String(n), { fontFamily: 'system-ui, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#2b2118', resolution: 2 })
          .setOrigin(0, 0.5),
      );
    }
  }
  // Centre the row inside the bubble's body (above its tip).
  const gap = 2;
  const width = parts.reduce((sum, p) => sum + p.displayWidth + gap, -gap);
  let x = -width / 2;
  for (const p of parts) {
    p.setPosition(x, -(BUBBLE.height - (BUBBLE.height - 12) / 2));
    x += p.displayWidth + gap;
  }
  d.bubble.add(parts);
}

function animate(ctx: FarmContext, obj: PlacedObject<ProcessorState>, view: ObjectView): void {
  const d = decor.get(obj.id);
  if (!d) return;
  // Cosmetic only, so it runs on real time: debug speed should not make the sails blur.
  const t = ctx.scene.time.now;
  const working = isWorking(obj);
  if (d.sails) {
    if (working && d.sails.anims.isPaused) d.sails.anims.resume();
    else if (!working && d.sails.anims.isPlaying) d.sails.anims.pause();
  }
  const a = d.smokeAt;
  d.puffs.forEach((p, i) => {
    p.setVisible(working);
    if (!working) return;
    const phase = (t / 1800 + i / PUFFS) % 1;
    p.setPosition(a.x + Math.sin(phase * 5 + i) * 6 + phase * 12, a.y - phase * 44);
    p.setAlpha(0.75 * (1 - phase));
    p.setScale(0.5 + phase * 0.8);
  });
  if (d.bubble.visible) d.bubble.y = d.bubbleY + Math.sin(t / 260) * 2;
  view.container.bringToTop(d.bubble);
}

function collectAndFloat(ctx: FarmContext, obj: PlacedObject<ProcessorState>): void {
  const got = collect(ctx.game, obj);
  const def = PROCESSORS[obj.type as ProcessorType];
  Object.entries(got).forEach(([itemId, n], i) => {
    ctx.ui.floatText(obj.x + (def.footprint.w - 1) / 2, obj.y - i * 0.6, `+${n} ${itemLabel(itemId)}`);
  });
  const left = readyCount(obj);
  if (left > 0) ctx.ui.toast(leftBehindMessage(got, left, `the ${def.name.toLowerCase()}`), 'error');
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
