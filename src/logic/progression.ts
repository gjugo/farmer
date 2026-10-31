import { isAnimalKind } from '../data/animals';
import { ACTIVE_GOALS, getGoal, GOALS, LEVEL_BONUS, LEVEL_XP, MAX_LEVEL, type GoalDef } from '../data/progression';
import { START_LAND } from './constants';
import type { Game } from './game';
import { FARM_PARCELS, parcelsBought } from './parcels';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import type { GameState } from './types';
import { levelForXp, unlocksAt, xpForLevel } from './unlocks';

/** One active goal. `progress` counts towards the goal's `count`. */
export interface GoalSlot {
  id: string;
  progress: number;
}

export interface ProgressionState {
  /** Total XP earned; the level follows from it. Never goes down. */
  xp: number;
  /** Active goals, at most `ACTIVE_GOALS`. */
  goals: GoalSlot[];
  /** Index in `GOALS` of the next goal to activate. */
  nextGoal: number;
}

export const PROGRESSION = 'progression';

export function initialProgression(xp = 0): ProgressionState {
  return {
    xp,
    goals: GOALS.slice(0, ACTIVE_GOALS).map((g) => ({ id: g.id, progress: 0 })),
    nextGoal: Math.min(ACTIVE_GOALS, GOALS.length),
  };
}

registerStateSlice<ProgressionState>(PROGRESSION, () => initialProgression());

const STATE_KINDS = new Set<GoalDef['kind']>(['own-buildings', 'own-animals', 'own-parcels', 'reach-level']);

export function isStateGoal(def: GoalDef): boolean {
  return STATE_KINDS.has(def.kind);
}

/** Current value of a state goal, read from the farm. */
export function stateGoalValue(state: GameState, def: GoalDef): number {
  switch (def.kind) {
    case 'own-buildings':
      return state.objects.filter((o) => o.type === def.type).length;
    case 'own-animals':
      return state.objects.reduce((n, o) => {
        const animals = Array.isArray(o.state.animals) ? (o.state.animals as { kind?: unknown }[]) : [];
        return n + animals.filter((a) => isAnimalKind(a?.kind) && (!def.animal || a.kind === def.animal)).length;
      }, 0);
    case 'own-parcels':
      return parcelsBought(state.land, FARM_PARCELS, START_LAND);
    case 'reach-level':
      return levelForXp(getSlice<ProgressionState>(state, PROGRESSION).xp);
    default:
      return 0;
  }
}

/** Repairs the slice from a save: valid XP, known goals, no duplicates. */
export function sanitizeProgression(state: GameState): ProgressionState {
  const raw = getSlice<unknown>(state, PROGRESSION);
  const p = isPlainObject(raw) ? raw : {};
  const xp = typeof p.xp === 'number' && Number.isFinite(p.xp) && p.xp > 0 ? p.xp : 0;
  const nextGoal =
    typeof p.nextGoal === 'number' && Number.isInteger(p.nextGoal) ? Math.max(0, Math.min(GOALS.length, p.nextGoal)) : ACTIVE_GOALS;
  const seen = new Set<string>();
  const goals: GoalSlot[] = [];
  for (const g of Array.isArray(p.goals) ? p.goals : []) {
    if (!isPlainObject(g) || typeof g.id !== 'string' || !getGoal(g.id) || seen.has(g.id)) continue;
    seen.add(g.id);
    const progress = typeof g.progress === 'number' && g.progress > 0 ? Math.floor(g.progress) : 0;
    goals.push({ id: g.id, progress });
  }
  const fixed: ProgressionState = { xp, goals: goals.slice(0, ACTIVE_GOALS), nextGoal };
  state.ext[PROGRESSION] = fixed;
  return fixed;
}

export interface GoalView {
  def: GoalDef;
  progress: number;
  target: number;
  complete: boolean;
}

export interface LevelInfo {
  level: number;
  /** Total XP. */
  xp: number;
  /** XP earned since this level started. */
  xpIntoLevel: number;
  /** XP from this level's start to the next one; null at the top level. */
  xpForNext: number | null;
  /** XP still missing for the next level; null at the top level. */
  xpToNext: number | null;
}

export function levelInfo(xp: number): LevelInfo {
  const level = levelForXp(xp);
  const start = xpForLevel(level);
  const next = level < MAX_LEVEL ? LEVEL_XP[level] : null;
  return {
    level,
    xp,
    xpIntoLevel: xp - start,
    xpForNext: next === null ? null : next - start,
    xpToNext: next === null ? null : next - xp,
  };
}

/**
 * XP, levels and goals. XP comes from income (1 XP per $1, via the `income` activity)
 * and from claimed goals. Goal progress is driven by activity events and, for state
 * goals, by object/land changes — never by polling.
 */
export class Progression {
  constructor(private readonly game: Game) {
    const { activity, events } = game;
    activity.on('income', ({ amount }) => {
      this.count((d) => d.kind === 'earn', amount);
      this.addXp(amount);
    });
    activity.on('harvested', ({ item, qty }) => this.count((d) => d.kind === 'harvest' && d.item === item, qty));
    activity.on('collected', ({ item, qty }) => this.count((d) => d.kind === 'collect' && d.item === item, qty));
    activity.on('made', ({ item, qty }) => this.count((d) => d.kind === 'make' && d.item === item, qty));
    activity.on('bought', ({ item, qty }) => this.count((d) => d.kind === 'buy' && d.item === item, qty));
    activity.on('sold', ({ item, qty }) => this.count((d) => d.kind === 'sell' && (!d.item || d.item === item), qty));
    activity.on('placed', ({ type }) => this.count((d) => d.kind === 'build' && d.type === type, 1));
    for (const e of ['objectAdded', 'objectRemoved', 'objectChanged', 'land'] as const) events.on(e, () => this.refreshStateGoals());
    events.on('reset', () => this.init());
    this.init();
  }

  private init(): void {
    sanitizeProgression(this.game.state);
    this.refreshStateGoals();
  }

  private get data(): ProgressionState {
    return getSlice<ProgressionState>(this.game.state, PROGRESSION);
  }

  get xp(): number {
    return this.data.xp;
  }

  get level(): number {
    return levelForXp(this.data.xp);
  }

  get info(): LevelInfo {
    return levelInfo(this.data.xp);
  }

  /** Adds XP and pays the bonus for every level reached on the way. */
  addXp(amount: number): void {
    if (!(amount > 0)) return;
    const before = this.level;
    this.data.xp += amount;
    const after = this.level;
    this.game.events.emit('xp', { xp: this.data.xp, level: after, delta: amount });
    for (let level = before + 1; level <= after; level++) {
      const bonus = LEVEL_BONUS * level;
      this.game.earn(bonus);
      this.game.events.emit('levelUp', { level, bonus, unlocks: unlocksAt(level) });
    }
    if (after !== before) this.refreshStateGoals();
  }

  /** Debug: jumps to the start of `level`. Going up pays the level bonuses as usual. */
  setLevel(level: number): void {
    const target = xpForLevel(level);
    if (target > this.data.xp) {
      this.addXp(target - this.data.xp);
      return;
    }
    const delta = target - this.data.xp;
    this.data.xp = target;
    this.game.events.emit('xp', { xp: target, level: this.level, delta });
    this.refreshStateGoals();
  }

  // Goals ---------------------------------------------------------------------

  goals(): GoalView[] {
    return this.data.goals.flatMap((slot) => {
      const def = getGoal(slot.id);
      if (!def) return [];
      const progress = Math.min(slot.progress, def.count);
      return [{ def, progress, target: def.count, complete: progress >= def.count }];
    });
  }

  /** How many active goals can be claimed. */
  claimable(): number {
    return this.goals().filter((g) => g.complete).length;
  }

  /** True when every goal in the list has been claimed. */
  get allDone(): boolean {
    return this.data.goals.length === 0 && this.data.nextGoal >= GOALS.length;
  }

  /** Pays a finished goal's reward and fills its slot with the next goal. Returns the goal, or null. */
  claim(id: string): GoalDef | null {
    const data = this.data;
    const i = data.goals.findIndex((s) => s.id === id);
    const view = this.goals().find((g) => g.def.id === id);
    if (i < 0 || !view?.complete) return null;
    const next = GOALS[data.nextGoal];
    if (next) {
      data.goals[i] = { id: next.id, progress: 0 };
      data.nextGoal++;
    } else {
      data.goals.splice(i, 1);
    }
    this.refreshStateGoals(true);
    this.game.earn(view.def.reward.money);
    this.addXp(view.def.reward.xp);
    this.game.activity.emit('goalClaimed', { id });
    return view.def;
  }

  /** Debug: marks every active goal as finished. */
  completeAll(): void {
    for (const slot of this.data.goals) slot.progress = getGoal(slot.id)?.count ?? slot.progress;
    this.emitGoals();
  }

  private count(match: (def: GoalDef) => boolean, amount: number): void {
    let changed = false;
    for (const slot of this.data.goals) {
      const def = getGoal(slot.id);
      if (!def || isStateGoal(def) || !match(def) || slot.progress >= def.count) continue;
      slot.progress = Math.min(def.count, slot.progress + amount);
      changed = true;
    }
    if (changed) this.emitGoals();
  }

  /** Re-reads state goals from the farm. A finished state goal stays finished until claimed. */
  private refreshStateGoals(force = false): void {
    let changed = force;
    for (const slot of this.data.goals) {
      const def = getGoal(slot.id);
      if (!def || !isStateGoal(def) || slot.progress >= def.count) continue;
      const value = Math.min(def.count, stateGoalValue(this.game.state, def));
      if (value !== slot.progress) {
        slot.progress = value;
        changed = true;
      }
    }
    if (changed) this.emitGoals();
  }

  private emitGoals(): void {
    this.game.events.emit('goals', this.goals());
  }
}
