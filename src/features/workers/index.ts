import Phaser from 'phaser';
import { FARMHOUSE } from '../../data/farmhouse';
import { TOOL_SPEED, TOOL_USES } from '../../data/tools';
import type { FarmContext, PlacedObject, SheetSpec } from '../../game/context';
import { onGameStart, registerDebugInfo, registerHudButton } from '../../game/hooks';
import { farmerActivity, farmerLoad, farmerName, placeName } from '../../game/workers';
import { timerRemaining } from '../../logic/clock';
import { formatDuration } from '../../logic/crops';
import type { Game } from '../../logic/game';
import { cartPose } from '../../logic/haul';
import { farmhouseLevel } from '../../logic/homes';
import { villageCentre, villageInfo } from '../../logic/roads';
import { onToolsWornOut, toolOf, toolsSummary } from '../../logic/tools';
import { siteProgress, sitesOf } from '../../logic/work';
import {
  assignFarmer,
  busyFarmers,
  freeFarmers,
  isWorkplaceType,
  jobPhase,
  jobsByFarmer,
  unassignFarmer,
  workerAt,
  workersOf,
  type Job,
} from '../../logic/workers';
import { facing, FARMER_ART, WORK_ANIM, type Facing, type FarmerAnim } from '../../scenes/art';
import { DEPTH, walkerDepth } from '../../scenes/depth';
import { gridToWorld } from '../../scenes/iso';
import { addArtSprite, addShadow } from '../../scenes/sprites';
import { h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';
import { familiesBlock, familiesSignature } from '../families';

/**
 * Farmers: every job sends a farmer from the village centre (the camp's tent, later the farmhouse) along the paths to
 * the work, a few seconds of it, and back. A farmer assigned to a field, pen or processing building does its
 * work by themselves; free farmers take hand-ordered jobs and build construction sites. Idle
 * farmers rest at the centre: in front of the tent (or the oldest cottage), on the farmhouse bench once it is built.
 * The farm starts with two; more come as families moving into cottages (`src/features/families`).
 * `window.farm.village` is `{ centre: { type, id, x, y }, farmhouse: id | null }`.
 * Rules live in `src/logic/workers.ts` (state, hiring, assignments), `src/logic/work.ts` (the
 * scheduler) and `src/logic/roads.ts`, numbers in `src/data/workers.ts`; hand-ordered work goes
 * through `withFarmer` and object panels get their farmer block from `workplacePanel` (`src/game/workers.ts`).
 */

/** Each farmer's running job, by farmer number. */
function jobsOf(game: Game): (Job | undefined)[] {
  return jobsByFarmer(game.state.clock, workersOf(game.state));
}

/** Built workplaces in build order: what a farmer can be assigned to. */
function workplaces(game: Game): PlacedObject[] {
  return game.state.objects.filter((o) => isWorkplaceType(o.type) && !o.site);
}

/** "🛠️ 18/30" (jobs left in farmer `i`'s tools) or "no tools". */
export function toolText(game: Game, i: number): string {
  const left = toolOf(game.state, i);
  return left === null ? 'no tools' : `🛠️ ${left}/${TOOL_USES}`;
}

/** "Tools: 6 of 8 farmers equipped · 3 in store". */
export function toolsLine(game: Game): string {
  const { inStore, equipped, farmers } = toolsSummary(game.state);
  return `🛠️ Tools: ${equipped} of ${farmers} ${farmers === 1 ? 'farmer' : 'farmers'} equipped · ${inStore} in store`;
}

/** The drop-down that sets farmer `i`'s workplace. */
function workplaceSelect(ctx: FarmContext, i: number): HTMLSelectElement {
  const { game } = ctx;
  const w = workersOf(game.state);
  const select = h(
    'select',
    {
      class: 'farmer-workplace',
      'aria-label': `Workplace of ${farmerName(i)}`,
      'data-testid': `farmer-workplace-${i}`,
      onchange: () => {
        if (select.value) assignFarmer(game, select.value, i);
        else unassignFarmer(game, i);
        select.blur();
        ctx.ui.toast(select.value ? `${farmerName(i)} now works at ${placeName(game, game.getObject(select.value)!)}` : `${farmerName(i)} is free`, 'success');
      },
    },
    h('option', { value: '', selected: !w.workplaces[i] }, 'No workplace (free)'),
    workplaces(game).map((o) => {
      const other = workerAt(game.state, o.id);
      const taken = other !== null && other !== i ? ` · ${farmerName(other)}` : '';
      return h('option', { value: o.id, selected: w.workplaces[i] === o.id }, `${placeName(game, o)}${taken}`);
    }),
  );
  return select;
}

function farmersSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  return {
    id: 'farmers',
    title: () => '👨‍🌾 Farmers',
    // Activities change all the time and are updated in place by tick(); a rebuild would close an open drop-down.
    signature: () => {
      const w = workersOf(game.state);
      return `${w.farmers}|${familiesSignature(game)}|${w.workplaces.join(',')}|${workplaces(game).map((o) => o.id).join(',')}`;
    },
    render: (body) => {
      const { farmers } = workersOf(game.state);
      const sites = sitesOf(game.state).length;
      body.append(
        h(
          'p',
          { class: 'muted farmers-intro' },
          'Give a farmer a workplace and they do its work by themselves: plough, sow and harvest a field, feed and collect a pen, keep a building making its recipe. Free farmers (no workplace, or nothing to do there) build construction sites and do what you tap. Farmers walk from the village centre (the camp, later the farmhouse) along paths.',
        ),
        h(
          'p',
          { class: 'farmers-count', 'data-testid': 'farmers-count' },
          h('strong', {}, `${freeFarmers(game.state)} of ${farmers}`),
          ` ${farmers === 1 ? 'farmer' : 'farmers'} free`,
          sites > 0 ? ` · 🚧 ${sites} ${sites === 1 ? 'site' : 'sites'} to build` : '',
        ),
        h(
          'p',
          { class: 'farmers-tools', 'data-testid': 'farmers-tools', title: `Farmers with tools work ${Math.round((TOOL_SPEED - 1) * 100)}% faster; tools last ${TOOL_USES} jobs` },
          ...withIcons(toolsLine(game)),
        ),
        h(
          'ul',
          { class: 'farmers-list', 'data-testid': 'farmers-list' },
          Array.from({ length: farmers }, (_, i) =>
            h(
              'li',
              { class: 'farmer', 'data-testid': `farmer-${i}` },
              h('span', { class: 'farmer-icon', 'aria-hidden': 'true' }, '👨‍🌾'),
              h('span', { class: 'farmer-name' }, farmerName(i)),
              h('span', { class: 'farmer-status', 'data-farmer': i, 'data-testid': `farmer-activity-${i}` }),
              h('span', { class: 'farmer-tool', 'data-farmer': i, 'data-testid': `farmer-tool-${i}` }),
              workplaceSelect(ctx, i),
            ),
          ),
        ),
      );
      updateActivities(game, body);
      // Farmers are families: a new one moves into a free cottage when approval is high enough.
      body.append(h('h3', { class: 'group-title' }, '👪 Families'), familiesBlock(game));
    },
    tick: (body) => updateActivities(game, body),
  };
}

/** Writes each farmer's activity (with the time left on their job) and tools into the sheet, in place. */
function updateActivities(game: Game, body: HTMLElement): void {
  const jobs = jobsOf(game);
  for (const el of body.querySelectorAll<HTMLElement>('.farmer-tool')) {
    const text = toolText(game, Number(el.dataset.farmer));
    if (el.dataset.text === text) continue;
    el.dataset.text = text;
    el.classList.toggle('none', text === 'no tools');
    el.replaceChildren(...withIcons(text));
  }
  const line = body.querySelector<HTMLElement>('.farmers-tools');
  const summary = toolsLine(game);
  if (line && line.dataset.text !== summary) {
    line.dataset.text = summary;
    line.replaceChildren(...withIcons(summary));
  }
  for (const el of body.querySelectorAll<HTMLElement>('.farmer-status')) {
    const i = Number(el.dataset.farmer);
    const job = jobs[i];
    const text = `${farmerActivity(game, i)}${job ? ` · ${formatDuration(timerRemaining(game.state.clock, job.timer))}` : ''}`;
    if (el.dataset.text === text) continue;
    el.dataset.text = text;
    el.dataset.state = job ? job.kind : workersOf(game.state).workplaces[i] ? 'waiting' : 'idle';
    el.closest('.farmer')?.classList.toggle('busy', !!job);
    el.replaceChildren(...withIcons(text));
  }
}

registerHudButton({
  id: 'farmers',
  label: 'Farmers',
  icon: '👨‍🌾',
  spot: { kind: 'tab', window: 'farm', order: 20, sheet: farmersSheet },
});

/** "3 at a workplace · 1 building" for the farmer chips. */
function farmerBreakdown(game: Game): string[] {
  const w = workersOf(game.state);
  const assigned = w.workplaces.filter(Boolean).length;
  const sites = sitesOf(game.state).length;
  return [
    `${w.farmers} ${w.farmers === 1 ? 'farmer' : 'farmers'}: ${busyFarmers(game.state)} at work now, ${freeFarmers(game.state)} free`,
    `${assigned} with a workplace, ${w.farmers - assigned} without`,
    sites ? `${sites} construction ${sites === 1 ? 'site' : 'sites'} waiting for a builder` : 'No construction waiting',
  ];
}

registerHudButton({
  id: 'free',
  label: 'Free farmers: resting, ready for the next job',
  icon: '🧑‍🌾',
  spot: { kind: 'chip', order: 10, opens: 'farmers', detail: (ctx) => farmerBreakdown(ctx.game) },
  live: (ctx) => ({ icon: '🧑‍🌾', label: String(freeFarmers(ctx.game.state)) }),
});

registerHudButton({
  id: 'working',
  label: 'Working farmers: busy with a job now',
  icon: '👷',
  spot: { kind: 'chip', order: 20, opens: 'farmers', detail: (ctx) => farmerBreakdown(ctx.game) },
  live: (ctx) => ({ icon: '👷', label: String(busyFarmers(ctx.game.state)) }),
});

/** The running game, for the debug info (set at game start). */
let current: Game | null = null;

/**
 * `window.farm.workers`, for QA: the farmers with their workplace and activity, assignments, crop plans,
 * recipes and construction sites (with build progress).
 */
registerDebugInfo('workers', () => {
  const game = current;
  if (!game) return null;
  const w = workersOf(game.state);
  const jobs = jobsOf(game);
  return structuredClone({
    farmers: w.farmers,
    free: freeFarmers(game.state),
    list: Array.from({ length: w.farmers }, (_, i) => ({
      farmer: i,
      workplace: w.workplaces[i],
      job: jobs[i]?.kind ?? null,
      carrying: jobs[i] ? farmerLoad(game, jobs[i]) : null,
      activity: farmerActivity(game, i),
      // Jobs left in the farmer's tools, or null without any.
      tool: toolOf(game.state, i),
    })),
    assignments: Object.fromEntries(w.workplaces.flatMap((id, i) => (id ? [[id, i]] : []))),
    plans: w.plans,
    recipes: w.recipes,
    sites: sitesOf(game.state).map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y, ...o.site!, builder: siteProgress(game.state, o.id) })),
  });
});

/** `window.farm.tools`, for QA: tools in store, farmers with tools, jobs per tool and the speed-up they give. */
registerDebugInfo('tools', () => {
  const game = current;
  if (!game) return null;
  const { inStore, equipped } = toolsSummary(game.state);
  return { inStore, equipped, usesPerTool: TOOL_USES, factor: TOOL_SPEED };
});

/** A tool broke and none are left in store: say so, at most once a game day. */
export const TOOLS_WORN_MESSAGE = 'Tools are wearing out: forge more at the blacksmith';

type Seat = { x: number; y: number; anim: FarmerAnim; facing: Facing };

/**
 * Where idle farmers wait at each farmhouse level, in grid units from its top-left tile: two on the bench on the open
 * pad left of the door (in front of the porch from level 2, inside the forecourt wall at level 3), the rest standing
 * about the front of the pad, clear of the door's way out and of the stock piles at its front-right corner
 * (src/features/storage/piles.ts). See `seatOf`.
 */
const SEATS: readonly (readonly Seat[])[] = [
  [
    { x: 0.5, y: 2.45, anim: 'sit', facing: 'sw' },
    { x: 0.85, y: 2.45, anim: 'sit', facing: 'sw' },
    { x: 2.45, y: 1.0, anim: 'idle', facing: 'se' },
    { x: 0.2, y: 2.7, anim: 'idle', facing: 'sw' },
    { x: 2.0, y: 2.65, anim: 'idle', facing: 'sw' },
    { x: 0.55, y: 2.8, anim: 'idle', facing: 'sw' },
    { x: 2.7, y: 1.9, anim: 'idle', facing: 'se' },
    { x: 2.35, y: 2.8, anim: 'idle', facing: 'sw' },
  ],
  [
    { x: 0.5, y: 2.5, anim: 'sit', facing: 'sw' },
    { x: 0.85, y: 2.5, anim: 'sit', facing: 'sw' },
    { x: 2.5, y: 1.0, anim: 'idle', facing: 'se' },
    { x: 0.2, y: 2.75, anim: 'idle', facing: 'sw' },
    { x: 2.0, y: 2.65, anim: 'idle', facing: 'sw' },
    { x: 0.55, y: 2.82, anim: 'idle', facing: 'sw' },
    { x: 2.7, y: 1.9, anim: 'idle', facing: 'se' },
    { x: 2.35, y: 2.8, anim: 'idle', facing: 'sw' },
  ],
  [
    { x: 0.5, y: 2.5, anim: 'sit', facing: 'sw' },
    { x: 0.85, y: 2.5, anim: 'sit', facing: 'sw' },
    { x: 2.5, y: 1.0, anim: 'idle', facing: 'se' },
    { x: 0.25, y: 2.7, anim: 'idle', facing: 'sw' },
    { x: 2.0, y: 2.6, anim: 'idle', facing: 'sw' },
    { x: 0.55, y: 2.75, anim: 'idle', facing: 'sw' },
    { x: 2.65, y: 1.9, anim: 'idle', facing: 'se' },
    { x: 2.3, y: 2.75, anim: 'idle', facing: 'sw' },
  ],
];

/** A farmer on the map: the animated sprite, its shadow, and a progress bar while working. */
interface FarmerSprite {
  body: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image | null;
  bar: Phaser.GameObjects.Container;
  fill: Phaser.GameObjects.Rectangle;
}

/** Farmer `i`'s spot at a farmhouse of `level`: a seat, or past them a crowd beside the house. */
function seatOf(i: number, level: number): Seat {
  const seats = SEATS[level - 1] ?? SEATS[0];
  if (i < seats.length) return seats[i];
  const k = i - seats.length;
  return { x: -0.35 - (k % 3) * 0.32, y: 0.4 + Math.floor(k / 3) * 0.45, anim: 'idle', facing: 'se' };
}

/**
 * Where idle farmer `i` waits: on the farmhouse bench (see `seatOf`) once it is built, else standing about the tile in
 * front of the tent (or the oldest cottage's door). Null on a farm without a centre.
 */
function restSpot(game: Game, i: number): Seat | null {
  const centre = villageCentre(game.state);
  if (!centre) return null;
  const house = centre.type === FARMHOUSE ? game.getObject(centre.id) : undefined;
  if (house) {
    const seat = seatOf(i, farmhouseLevel(house));
    return { ...seat, x: house.x + seat.x, y: house.y + seat.y };
  }
  return { x: centre.x + 0.2 + (i % 3) * 0.3, y: centre.y + 0.2 + Math.floor(i / 3) * 0.3, anim: 'idle', facing: i % 2 ? 'sw' : 'se' };
}

/** How far beside the cart its carter walks (tiles). */
const CARTER_BESIDE = 0.45;

const BAR_W = 40;
/** The bar floats this far above the farmer's feet. */
const BAR_RISE = 62;

function addFarmer(scene: Phaser.Scene): FarmerSprite {
  const body = addArtSprite(scene, 0, 0, FARMER_ART);
  const shadow = addShadow(scene, 0, 0, FARMER_ART)?.setDepth(DEPTH.shadow) ?? null;
  const back = scene.add.rectangle(0, 0, BAR_W + 4, 8, 0x2b2118);
  const fill = scene.add.rectangle(-BAR_W / 2, 0, 0, 4, 0x9be15d).setOrigin(0, 0.5);
  // Above everything standing, below the build ghost and floating text.
  const bar = scene.add.container(0, 0, [back, fill]).setDepth(DEPTH.hover - 1);
  return { body, shadow, bar, fill };
}

function destroyFarmer(f: FarmerSprite): void {
  f.body.destroy();
  f.shadow?.destroy();
  f.bar.destroy();
}

type Point = { x: number; y: number };

/** The point a share `t` (0..1) of the way along a polyline, and the direction it heads there. */
function along(line: Point[], t: number): { at: Point; dir: Point } {
  const lengths = line.slice(1).map((p, i) => Math.hypot(p.x - line[i].x, p.y - line[i].y));
  let left = t * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dir = { x: b.x - a.x, y: b.y - a.y };
    if (left <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] > 0 ? Math.min(1, left / lengths[i]) : 1;
      return { at: { x: a.x + dir.x * k, y: a.y + dir.y * k }, dir };
    }
    left -= lengths[i];
  }
  return { at: line[line.length - 1], dir: { x: 1, y: 0 } };
}

/** Where farmer `i` is, what they do and which way they face right now. */
function farmerPose(game: Game, i: number, job: Job | undefined): { at: Point; anim: FarmerAnim; facing: Facing; progress: number | null } | null {
  const seat = restSpot(game, i);
  const home = seat && { x: seat.x, y: seat.y };
  if (!job) return seat && { at: { x: seat.x, y: seat.y }, anim: seat.anim, facing: seat.facing, progress: null };
  const route = job.route ?? [];
  const line: Point[] = [...(home && route.length ? [home] : []), ...route.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 })), { x: job.x, y: job.y }];
  const { phase, t } = jobPhase(game.state.clock, job);
  // A carter walks beside the ox (on its left, towards the viewer), and loads and unloads by the cart.
  const barn = job.haul ? game.getObject(job.haul.barn) : undefined;
  const cart = phase === 'work' && job.haul ? cartPose(job.haul, barn, game.now) : null;
  if (cart && cart.leg !== 'parked') {
    const n = Math.hypot(cart.dir.x, cart.dir.y) || 1;
    const side = { x: cart.dir.y / n, y: -cart.dir.x / n };
    const flip = side.x + side.y < 0 ? -1 : 1;
    const at = { x: cart.at.x + side.x * flip * CARTER_BESIDE, y: cart.at.y + side.y * flip * CARTER_BESIDE };
    const f = facing(cart.dir.x, cart.dir.y);
    return { at, anim: cart.leg === 'drive' ? 'walk' : 'load', facing: f, progress: null };
  }
  if (phase === 'work') {
    const { dir } = along(line, 1);
    return { at: { x: job.x, y: job.y }, anim: WORK_ANIM[job.kind], facing: facing(dir.x, dir.y), progress: t };
  }
  const { at, dir } = along(line, phase === 'out' ? t : 1 - t);
  const load = farmerLoad(game, job);
  return { at, anim: load ? `carry_${load}` : 'walk', facing: phase === 'out' ? facing(dir.x, dir.y) : facing(-dir.x, -dir.y), progress: null };
}

onGameStart((ctx) => {
  current = ctx.game;
  registerDebugInfo('village', () => villageInfo(ctx.game.state));
  onToolsWornOut(ctx.game, () => ctx.ui.toast(TOOLS_WORN_MESSAGE, 'info'));
  const scene = ctx.scene;
  const sprites: FarmerSprite[] = [];
  const onUpdate = () => {
    const { game } = ctx;
    const w = workersOf(game.state);
    while (sprites.length > w.farmers) destroyFarmer(sprites.pop()!);
    while (sprites.length < w.farmers) sprites.push(addFarmer(scene));
    jobsByFarmer(game.state.clock, w).forEach((job, i) => {
      const f = sprites[i];
      const pose = farmerPose(game, i, job);
      f.body.setVisible(pose !== null);
      f.shadow?.setVisible(pose !== null);
      f.bar.setVisible(pose?.progress != null);
      if (!pose) return;
      const p = gridToWorld(pose.at.x, pose.at.y);
      const anim = `${FARMER_ART}_${pose.anim}_${pose.facing}`;
      f.body.setPosition(p.x, p.y).setDepth(walkerDepth(pose.at.x, pose.at.y));
      if (scene.anims.exists(anim)) f.body.play(anim, true);
      f.shadow?.setPosition(p.x, p.y).setFrame(f.body.frame.name);
      if (pose.progress != null) {
        f.bar.setPosition(p.x, p.y - BAR_RISE);
        f.fill.width = BAR_W * pose.progress;
      }
    });
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    sprites.forEach(destroyFarmer);
  });
});
