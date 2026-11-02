import { ANIMALS } from '../data/animals';
import { FIELD, getCrop } from '../data/crops';
import { MAX_OFFLINE_MS, SUMMARY_MIN_AWAY_MS } from '../data/offline';
import { isProcessorType } from '../data/processing';
import { isResourceType } from '../data/resourceBuildings';
import { animalsOf, isPenType, type PenState } from './animals';
import { dayOf, type Timer } from './clock';
import { Game } from './game';
import * as inventory from './inventory';
import { sanitize, settle, type ProcessorState } from './processing';
import * as resources from './resources';
import { updateTrader } from './trader';
import type { GameState, Inventory, PlacedObject } from './types';
import { runWork } from './work';

/** What the farmers did while the player was away. */
export interface FarmerWork {
  /** Item id → harvested from fields. */
  harvested: Inventory;
  /** Crop id → times sown (one field sown twice counts 2). */
  sown: Record<string, number>;
  /** Item id → collected from pens (eggs, milk, wool). */
  collected: Inventory;
  /** Item id → finished goods collected from processing buildings. */
  made: Inventory;
  /** Buildable type → construction sites finished. */
  built: Record<string, number>;
  /** Item id → materials made by resource buildings (stored, or waiting in the building for room). */
  materials: Inventory;
}

/** What happened while the player was away. Built from the timers that ended, never by diffing the whole state. */
export interface CatchUpResult {
  /** Real milliseconds away. Negative when the device clock went backwards. */
  awayMs: number;
  /** Game milliseconds applied, always at ×1: between 0 and `MAX_OFFLINE_MS`. */
  appliedMs: number;
  /** True when the absence was longer than `MAX_OFFLINE_MS` and the rest was dropped. */
  capped: boolean;
  /** Crop id → fields that became ripe. */
  cropsReady: Record<string, number>;
  /**
   * Item id → goods made and waiting to be collected: animal products in their pens, processing output in its
   * buildings, and materials left in resource buildings while the storehouse was full.
   */
  produced: Inventory;
  /** Processing jobs that finished. */
  jobsFinished: number;
  /** What the farmers did: assigned ones work their workplaces, free ones build sites. */
  work: FarmerWork;
  /** Families that moved in and moved away. */
  families: { arrived: number; left: number };
  /** Travelling traders that came while the player was away (they left, or stay today, without trading). */
  traders: { missed: number };
  dayBefore: number;
  dayAfter: number;
  /** Ids of objects whose state changed, so their views can refresh. */
  changed: string[];
}

/** Game time at which a timer ends. */
function endOf(timer: Timer): number {
  return timer.start + timer.duration;
}

/**
 * Moves the farm forward by the real time the player was away, at ×1 whatever the
 * debug speed is. Every timer lives on the game clock as an end time, so jumping the
 * clock finishes crops and animal cycles exactly, and processing queues are settled
 * job by job (each next job starts when the previous one ended). Farmers work on the
 * way: the work scheduler (`runWork`) steps from one event to the next, exactly as it
 * does while playing. This also gathers the summary.
 */
export interface CatchUpOptions {
  /**
   * The player was away (default): traders arriving meanwhile come and go without trading. The debug "Next day" and
   * "Next season" jumps pass false, so a trader due then arrives as in play.
   */
  away?: boolean;
}

export function catchUp(target: Game | GameState, awayMs: number, { away = true }: CatchUpOptions = {}): CatchUpResult {
  const game = target instanceof Game ? target : new Game(target);
  const state = game.state;
  const clock = state.clock;
  const appliedMs = Number.isFinite(awayMs) && awayMs > 0 ? Math.min(awayMs, MAX_OFFLINE_MS) : 0;
  const from = clock.elapsed;
  const result: CatchUpResult = {
    awayMs,
    appliedMs,
    capped: awayMs > MAX_OFFLINE_MS,
    cropsReady: {},
    produced: {},
    jobsFinished: 0,
    work: { harvested: {}, sown: {}, collected: {}, made: {}, built: {}, materials: {} },
    families: { arrived: 0, left: 0 },
    traders: { missed: 0 },
    dayBefore: dayOf(clock),
    dayAfter: dayOf(clock),
    changed: [],
  };
  if (appliedMs === 0) return result;

  const processors = state.objects.filter((o) => isProcessorType(o.type)) as unknown as PlacedObject<ProcessorState>[];
  // Bring buildings up to date before the jump, so only jobs that end while away are counted.
  for (const obj of processors) {
    sanitize(obj, clock);
    settle(clock, obj);
  }
  const readyBefore = new Map(processors.map((o) => [o.id, { ...o.state.ready }]));
  const mines = state.objects.filter((o) => isResourceType(o.type)) as unknown as PlacedObject<resources.ResourceState>[];
  for (const obj of mines) resources.sanitize(obj);
  const waitingBefore = new Map(mines.map((o) => [o.id, o.state.waiting]));

  const { work } = result;
  const { activity } = game;
  const listening = [
    activity.on('harvested', ({ item, qty }) => inventory.add(work.harvested, item, qty)),
    activity.on('planted', ({ crop }) => inventory.add(work.sown, crop, 1)),
    activity.on('collected', ({ item, qty }) => inventory.add(work.collected, item, qty)),
    activity.on('made', ({ item, qty }) => inventory.add(work.made, item, qty)),
    activity.on('built', ({ type }) => inventory.add(work.built, type, 1)),
    activity.on('produced', ({ item, qty }) => inventory.add(work.materials, item, qty)),
    activity.on('familyArrived', () => result.families.arrived++),
    activity.on('familyLeft', () => result.families.left++),
  ];
  const changed = new Set<string>();
  const settled = (obj: PlacedObject, finished: number) => {
    if (finished === 0) return;
    result.jobsFinished += finished;
    changed.add(obj.id);
  };
  // Away, the trader is brought up to the moment the player left, then every arrival on the way counts as missed.
  // A debug jump leaves him to the next frame, as in play (so his arrival and departure are announced).
  if (away) updateTrader(game);
  runWork(game, from + appliedMs, { onSettled: settled });
  if (away) result.traders.missed = updateTrader(game, { away }).missed;
  listening.forEach((off) => off());
  const to = clock.elapsed;
  const endedAway = (timer: Timer | null) => !!timer && endOf(timer) > from && endOf(timer) <= to;

  for (const obj of state.objects) {
    if (obj.type === FIELD) {
      const crop = typeof obj.state.crop === 'string' ? getCrop(obj.state.crop) : undefined;
      if (crop && endedAway(obj.state.timer as Timer | null)) {
        result.cropsReady[crop.id] = (result.cropsReady[crop.id] ?? 0) + 1;
        changed.add(obj.id);
      }
    } else if (isPenType(obj.type)) {
      for (const animal of animalsOf(obj as unknown as PlacedObject<PenState>)) {
        if (!endedAway(animal.timer)) continue;
        inventory.add(result.produced, ANIMALS[animal.kind].product, 1);
        changed.add(obj.id);
      }
    }
  }

  for (const obj of processors) {
    const before = readyBefore.get(obj.id) ?? {};
    settled(obj, settle(clock, obj));
    // Goods a farmer collected meanwhile are in `work.made`: count only what waits now and did not before.
    for (const [item, qty] of Object.entries(obj.state.ready)) inventory.add(result.produced, item, Math.max(0, qty - (before[item] ?? 0)));
  }

  for (const obj of mines) {
    const more = obj.state.waiting - (waitingBefore.get(obj.id) ?? 0);
    if (more > 0) inventory.add(result.produced, resources.defOf(obj).output, more);
    changed.add(obj.id);
  }

  result.dayAfter = dayOf(clock);
  result.changed = [...changed];
  return result;
}

/** Runs `catchUp` on a live game and tells the HUD, the scene and features about it. */
export function catchUpGame(game: Game, awayMs: number, options: CatchUpOptions = {}): CatchUpResult {
  const result = catchUp(game, awayMs, options);
  // A zero tick moves nothing but announces a new day.
  game.tick(0);
  for (const id of result.changed) {
    const obj = game.getObject(id);
    if (obj) game.touch(obj);
  }
  return result;
}

/** Whether the welcome-back summary should be shown for this catch-up. */
export function shouldShowSummary(result: CatchUpResult): boolean {
  return result.awayMs > SUMMARY_MIN_AWAY_MS;
}

/** "3 d 4 h", "2 h 5 min", "12 min", "40 s" for a real-time duration. */
export function formatAway(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const hr = Math.floor((s % 86_400) / 3600);
  const min = Math.floor((s % 3600) / 60);
  if (d > 0) return hr > 0 ? `${d} d ${hr} h` : `${d} d`;
  if (hr > 0) return min > 0 ? `${hr} h ${min} min` : `${hr} h`;
  if (min > 0) return `${min} min`;
  return `${s} s`;
}
