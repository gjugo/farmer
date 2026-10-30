import Phaser from 'phaser';
import { FARMHOUSE } from '../../data/farmhouse';
import { JOBS, MAX_FARMERS } from '../../data/workers';
import type { FarmContext, SheetSpec } from '../../game/context';
import { onGameStart, registerBehavior, registerDebugInfo, registerHudButton } from '../../game/hooks';
import { timerRemaining } from '../../logic/clock';
import { formatDuration } from '../../logic/crops';
import type { Game } from '../../logic/game';
import { farmhouseOf } from '../../logic/roads';
import { freeFarmers, hireCost, hireFarmer, jobPhase, jobsByFarmer, workersOf, type Job, type JobPhase } from '../../logic/workers';
import { facing, FARMER_ART, type Facing, type FarmerAnim } from '../../scenes/art';
import { DEPTH, walkerDepth } from '../../scenes/depth';
import { gridToWorld } from '../../scenes/iso';
import { addArtSprite, addShadow } from '../../scenes/sprites';
import { formatMoney, h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';

/**
 * Farmers: building, planting, harvesting and feeding animals each send a farmer from the
 * farmhouse along the paths to the work, a few seconds of it, and back. Idle farmers rest at
 * the farmhouse. The farm starts with one; hire more from 👨‍🌾 Farmers in the HUD.
 * Rules live in `src/logic/workers.ts` and `src/logic/roads.ts`, numbers in `src/data/workers.ts`,
 * and call sites go through `withFarmer` (`src/game/workers.ts`).
 */

/** Each farmer's running job, by farmer number. */
function jobsOf(game: Game): (Job | undefined)[] {
  return jobsByFarmer(game.state.clock, workersOf(game.state));
}

const PHASE_NOTE: Record<JobPhase, string> = { out: ' (on the way)', work: '', back: ' (heading home)' };

function jobLeft(game: Game, job: Job): string {
  return formatDuration(timerRemaining(game.state.clock, job.timer));
}

function farmersSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  return {
    id: 'farmers',
    title: () => '👨‍🌾 Farmers',
    signature: () => {
      const cost = hireCost(game.state);
      const jobs = jobsOf(game).map((j) => (j ? `${j.kind}@${j.timer.start}:${jobPhase(game.state.clock, j).phase}` : '-'));
      return `${workersOf(game.state).farmers}|${cost}|${cost !== null && game.canAfford(cost)}|${jobs.join(',')}`;
    },
    render: (body) => {
      const { farmers } = workersOf(game.state);
      const jobs = jobsOf(game);
      body.append(
        h(
          'p',
          { class: 'muted farmers-intro' },
          'Farmers build, plant, harvest and feed the animals. They walk from the farmhouse along paths, so a job needs a path from the farmhouse door to it.',
        ),
        h(
          'p',
          { class: 'farmers-count', 'data-testid': 'farmers-count' },
          h('strong', {}, `${freeFarmers(game.state)} of ${farmers}`),
          ` ${farmers === 1 ? 'farmer' : 'farmers'} free`,
        ),
        h(
          'ul',
          { class: 'farmers-list', 'data-testid': 'farmers-list' },
          Array.from({ length: farmers }, (_, i) => {
            const job = jobs[i];
            return h(
              'li',
              { class: `farmer${job ? ' busy' : ''}`, 'data-testid': `farmer-${i}`, 'data-state': job ? job.kind : 'idle' },
              h('span', { class: 'farmer-icon', 'aria-hidden': 'true' }, '👨‍🌾'),
              h('span', { class: 'farmer-name' }, `Farmer ${i + 1}`),
              job
                ? h(
                    'span',
                    { class: 'farmer-status' },
                    ...withIcons(`${JOBS[job.kind].icon} ${JOBS[job.kind].label}${PHASE_NOTE[jobPhase(game.state.clock, job).phase]} · `),
                    h('span', { class: 'farmer-left', 'data-job': i }, jobLeft(game, job)),
                  )
                : h('span', { class: 'farmer-status muted' }, 'Resting at the farmhouse'),
            );
          }),
        ),
      );
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
    tick: (body) => {
      const jobs = jobsOf(game);
      for (const el of body.querySelectorAll<HTMLElement>('.farmer-left')) {
        const job = jobs[Number(el.dataset.job)];
        const text = job ? jobLeft(game, job) : '';
        if (el.textContent !== text) el.textContent = text;
      }
    },
  };
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

registerDebugInfo('workers', () =>
  current ? Object.freeze({ farmers: workersOf(current.state).farmers, free: freeFarmers(current.state), hireCost: hireCost(current.state) }) : null,
);

/** Where idle farmers wait, in grid units from the farmhouse's top-left tile: two on the bench, the rest standing about. */
const SEATS: { x: number; y: number; anim: FarmerAnim; facing: Facing }[] = [
  { x: 0.45, y: 1.69, anim: 'sit', facing: 'sw' },
  { x: 0.8, y: 1.69, anim: 'sit', facing: 'sw' },
  { x: 1.9, y: 0.8, anim: 'idle', facing: 'se' },
  { x: 1.9, y: 1.2, anim: 'idle', facing: 'se' },
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
  const seat = SEATS[i % SEATS.length];
  const home = house ? { x: house.x + seat.x, y: house.y + seat.y } : null;
  if (!job) return home && { at: home, anim: seat.anim, facing: seat.facing, progress: null };
  const route = job.route ?? [];
  const line: Point[] = [...(home && route.length ? [home] : []), ...route.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 })), { x: job.x, y: job.y }];
  const { phase, t } = jobPhase(game.state.clock, job);
  if (phase === 'work') {
    const { dir } = along(line, 1);
    return { at: { x: job.x, y: job.y }, anim: job.kind, facing: facing(dir.x, dir.y), progress: t };
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
      ],
    };
  },
});
