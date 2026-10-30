import Phaser from 'phaser';
import { JOBS, MAX_FARMERS } from '../../data/workers';
import type { FarmContext, SheetSpec } from '../../game/context';
import { onGameStart, registerDebugInfo, registerHudButton } from '../../game/hooks';
import { timerProgress, timerRemaining } from '../../logic/clock';
import { formatDuration } from '../../logic/crops';
import type { Game } from '../../logic/game';
import { activeJobs, freeFarmers, hireCost, hireFarmer, workersOf, type Job } from '../../logic/workers';
import { DEPTH } from '../../scenes/depth';
import { gridToWorld } from '../../scenes/iso';
import { formatMoney, h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';

/**
 * Farmers: building, planting, harvesting and feeding animals each keep a farmer busy
 * for a few seconds. The farm starts with one; hire more from 👨‍🌾 Farmers in the HUD.
 * Rules live in `src/logic/workers.ts`, numbers in `src/data/workers.ts`, and call sites
 * go through `withFarmer` (`src/game/workers.ts`).
 */

/** Running jobs, soonest finished first. */
function jobsOf(game: Game): Job[] {
  return activeJobs(game.state.clock, workersOf(game.state)).sort((a, b) => a.timer.start + a.timer.duration - (b.timer.start + b.timer.duration));
}

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
      const jobs = jobsOf(game).map((j) => `${j.kind}@${j.timer.start}`);
      return `${workersOf(game.state).farmers}|${cost}|${cost !== null && game.canAfford(cost)}|${jobs.join(',')}`;
    },
    render: (body) => {
      const { farmers } = workersOf(game.state);
      const jobs = jobsOf(game);
      body.append(
        h('p', { class: 'muted farmers-intro' }, 'Farmers build, plant, harvest and feed the animals. Each job keeps one busy for a few seconds.'),
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
                    ...withIcons(`${JOBS[job.kind].icon} ${JOBS[job.kind].label} · `),
                    h('span', { class: 'farmer-left', 'data-job': i }, jobLeft(game, job)),
                  )
                : h('span', { class: 'farmer-status muted' }, 'Ready for work'),
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

/** A farmer at work on the map: the farmer, what they do, and a progress bar. */
interface Marker {
  root: Phaser.GameObjects.Container;
  farmer: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
}

const BAR_W = 56;

function addMarker(scene: Phaser.Scene, job: Job): Marker {
  const style = { fontFamily: 'system-ui, sans-serif', fontSize: '40px', resolution: 2 };
  const farmer = scene.add.text(0, 0, '👨‍🌾', style).setOrigin(0.5, 1);
  const tool = scene.add.text(22, -8, JOBS[job.kind].icon, { ...style, fontSize: '24px' }).setOrigin(0.5, 1);
  const back = scene.add.rectangle(0, 8, BAR_W + 4, 10, 0x2b2118).setOrigin(0.5, 0.5);
  const bar = scene.add.rectangle(-BAR_W / 2, 8, 0, 6, 0x9be15d).setOrigin(0, 0.5);
  const { x, y } = gridToWorld(job.x, job.y);
  // Above everything standing, below the build ghost and floating text.
  const root = scene.add.container(x, y, [back, bar, farmer, tool]).setDepth(DEPTH.hover - 1);
  return { root, farmer, bar };
}

onGameStart((ctx) => {
  current = ctx.game;
  const scene = ctx.scene;
  const markers = new Map<Job, Marker>();
  const onUpdate = () => {
    const { game } = ctx;
    const jobs = new Set(activeJobs(game.state.clock, workersOf(game.state)));
    for (const [job, m] of markers) {
      if (jobs.has(job)) continue;
      m.root.destroy();
      markers.delete(job);
    }
    for (const job of jobs) {
      const m = markers.get(job) ?? addMarker(scene, job);
      markers.set(job, m);
      m.bar.width = BAR_W * timerProgress(game.state.clock, job.timer);
      // A gentle bob while working; cosmetic, so on real time.
      m.farmer.y = Math.sin(scene.time.now / 160) * 3;
    }
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate));
});
