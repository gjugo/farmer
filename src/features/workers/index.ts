import Phaser from 'phaser';
import { FARMHOUSE } from '../../data/farmhouse';
import { MAX_FARMERS, type JobKind } from '../../data/workers';
import type { FarmContext, PlacedObject, SheetSpec } from '../../game/context';
import { onGameStart, registerBehavior, registerDebugInfo, registerHudButton } from '../../game/hooks';
import { farmerActivity, farmerName, placeName } from '../../game/workers';
import { timerRemaining } from '../../logic/clock';
import { formatDuration } from '../../logic/crops';
import type { Game } from '../../logic/game';
import { farmhouseOf } from '../../logic/roads';
import { siteProgress, sitesOf } from '../../logic/work';
import {
  assignFarmer,
  freeFarmers,
  hireCost,
  hireFarmer,
  isWorkplaceType,
  jobPhase,
  jobsByFarmer,
  unassignFarmer,
  workerAt,
  workersOf,
  type Job,
} from '../../logic/workers';
import { facing, FARMER_ART, type Facing, type FarmerAnim } from '../../scenes/art';
import { DEPTH, walkerDepth } from '../../scenes/depth';
import { gridToWorld } from '../../scenes/iso';
import { addArtSprite, addShadow } from '../../scenes/sprites';
import { formatMoney, h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';

/**
 * Farmers: every job sends a farmer from the farmhouse along the paths to the work, a few
 * seconds of it, and back. A farmer assigned to a field, pen or processing building does its
 * work by themselves; free farmers take hand-ordered jobs and build construction sites. Idle
 * farmers rest at the farmhouse. The farm starts with one; hire more from 👨‍🌾 Farmers in the HUD.
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
      const cost = hireCost(game.state);
      const w = workersOf(game.state);
      return `${w.farmers}|${cost}|${cost !== null && game.canAfford(cost)}|${w.workplaces.join(',')}|${workplaces(game).map((o) => o.id).join(',')}`;
    },
    render: (body) => {
      const { farmers } = workersOf(game.state);
      const sites = sitesOf(game.state).length;
      body.append(
        h(
          'p',
          { class: 'muted farmers-intro' },
          'Give a farmer a workplace and they do its work by themselves: plough, sow and harvest a field, feed and collect a pen, keep a building making its recipe. Free farmers (no workplace, or nothing to do there) build construction sites and do what you tap. Farmers walk from the farmhouse along paths.',
        ),
        h(
          'p',
          { class: 'farmers-count', 'data-testid': 'farmers-count' },
          h('strong', {}, `${freeFarmers(game.state)} of ${farmers}`),
          ` ${farmers === 1 ? 'farmer' : 'farmers'} free`,
          sites > 0 ? ` · 🚧 ${sites} ${sites === 1 ? 'site' : 'sites'} to build` : '',
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
              workplaceSelect(ctx, i),
            ),
          ),
        ),
      );
      updateActivities(game, body);
      const cost = hireCost(game.state);
      if (cost === null) {
        body.append(h('p', { class: 'muted', 'data-testid': 'farmers-max' }, `Your farm employs the most farmers it can (${MAX_FARMERS}).`));
        return;
      }
      const short = cost - game.money;
      body.append(
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: short > 0,
              'data-testid': 'hire-farmer',
              onclick: () => {
                const r = hireFarmer(game);
                if (r.ok) ctx.ui.toast(`Farmer ${r.farmers} joined the farm!`, 'success');
                else ctx.ui.toast(r.reason === 'max' ? 'No room for more farmers' : 'Not enough money', 'error');
              },
            },
            `Hire a farmer · ${formatMoney(cost)}`,
          ),
        ),
      );
      if (short > 0) body.append(h('p', { class: 'muted' }, `You need ${formatMoney(short)} more — sell goods at the Market.`));
    },
    tick: (body) => updateActivities(game, body),
  };
}

/** Writes each farmer's activity (with the time left on their job) into the sheet, in place. */
function updateActivities(game: Game, body: HTMLElement): void {
  const jobs = jobsOf(game);
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
  onClick: (ctx) => ctx.ui.toggleSheet(farmersSheet(ctx)),
  live: (ctx) => ({ icon: '👨‍🌾', label: `Farmers ${freeFarmers(ctx.game.state)}/${workersOf(ctx.game.state).farmers}` }),
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
    hireCost: hireCost(game.state),
    list: Array.from({ length: w.farmers }, (_, i) => ({
      farmer: i,
      workplace: w.workplaces[i],
      job: jobs[i]?.kind ?? null,
      activity: farmerActivity(game, i),
    })),
    assignments: Object.fromEntries(w.workplaces.flatMap((id, i) => (id ? [[id, i]] : []))),
    plans: w.plans,
    recipes: w.recipes,
    sites: sitesOf(game.state).map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y, ...o.site!, builder: siteProgress(game.state, o.id) })),
  });
});

/** Where idle farmers wait, in grid units from the farmhouse's top-left tile: two on the bench, the rest standing about (see `seatOf`). */
const SEATS: { x: number; y: number; anim: FarmerAnim; facing: Facing }[] = [
  { x: 0.45, y: 1.69, anim: 'sit', facing: 'sw' },
  { x: 0.8, y: 1.69, anim: 'sit', facing: 'sw' },
  // Clear of the stock piles at the farmhouse's right side (src/features/storage/piles.ts).
  { x: 1.92, y: 1.3, anim: 'idle', facing: 'se' },
  { x: 0.12, y: 1.12, anim: 'idle', facing: 'sw' },
  { x: 1.75, y: 1.93, anim: 'idle', facing: 'sw' },
  { x: 0.1, y: 1.45, anim: 'idle', facing: 'sw' },
  { x: 1.02, y: 1.95, anim: 'idle', facing: 'sw' },
  { x: 1.92, y: 1.58, anim: 'idle', facing: 'se' },
];

/** A farmer on the map: the animated sprite, its shadow, and a progress bar while working. */
interface FarmerSprite {
  body: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image | null;
  bar: Phaser.GameObjects.Container;
  fill: Phaser.GameObjects.Rectangle;
}

/** Farmer `i`'s spot at the farmhouse: a seat, or past them a crowd in front of the house. */
function seatOf(i: number): (typeof SEATS)[number] {
  if (i < SEATS.length) return SEATS[i];
  const k = i - SEATS.length;
  return { x: -0.35 - (k % 3) * 0.32, y: 0.4 + Math.floor(k / 3) * 0.45, anim: 'idle', facing: 'se' };
}

/** The animation for each job's work. */
const WORK_ANIM: Record<JobKind, FarmerAnim> = {
  build: 'build',
  plough: 'plough',
  plant: 'plant',
  harvest: 'harvest',
  feed: 'feed',
  collect: 'harvest',
  load: 'feed',
  // Swinging an axe or a pick: the building swing.
  chop: 'build',
  quarry: 'build',
  mine: 'build',
};

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
  const house = farmhouseOf(game.state);
  const seat = seatOf(i);
  const home = house ? { x: house.x + seat.x, y: house.y + seat.y } : null;
  if (!job) return home && { at: home, anim: seat.anim, facing: seat.facing, progress: null };
  const route = job.route ?? [];
  const line: Point[] = [...(home && route.length ? [home] : []), ...route.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 })), { x: job.x, y: job.y }];
  const { phase, t } = jobPhase(game.state.clock, job);
  if (phase === 'work') {
    const { dir } = along(line, 1);
    return { at: { x: job.x, y: job.y }, anim: WORK_ANIM[job.kind], facing: facing(dir.x, dir.y), progress: t };
  }
  const { at, dir } = along(line, phase === 'out' ? t : 1 - t);
  return { at, anim: 'walk', facing: phase === 'out' ? facing(dir.x, dir.y) : facing(-dir.x, -dir.y), progress: null };
}

onGameStart((ctx) => {
  current = ctx.game;
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

registerBehavior(FARMHOUSE, {
  panel: (ctx) => {
    const { farmers } = workersOf(ctx.game.state);
    const free = freeFarmers(ctx.game.state);
    return {
      title: 'Farmhouse',
      icon: '🏠',
      lines: [
        `Home of your ${farmers === 1 ? 'farmer' : `${farmers} farmers`}; ${free} resting on the bench out front.`,
        'Farmers walk out of the door along paths. Lay a path from the door to every field, pen and building you want worked.',
        'Give farmers a workplace in 👨‍🌾 Farmers or from the workplace itself.',
      ],
    };
  },
});
