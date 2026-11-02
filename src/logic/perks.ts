import { materialEntries, type MaterialCost } from '../data/materials';
import { FIRST_PERK_LEVEL, getPerk, PERK_OFFERS, PERKS, type PerkDef, type PerkId } from '../data/perks';
import { MAX_LEVEL } from '../data/progression';
import { buildWorkMs } from '../data/workers';
import type { Game } from './game';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import type { GameState } from './types';

/**
 * Perk rules: which perks a farm has taken, which level-up choices are still open, and what the three cards of a
 * choice are. Every effect is read through `perkFactor` at one place in the rules, so live play, ×60 and offline
 * catch-up (which all run the same rules on the game clock) agree.
 */

export interface TakenPerk {
  level: number;
  id: PerkId;
}

export interface PerksState {
  /**
   * The farm's seed: with the level, it fixes the cards of each choice, so a reload never rerolls them. Null until
   * the farm is first set up (a new game, or a save from before perks: see `initPerks`).
   */
  seed: number | null;
  /** Perks taken, in the order they were taken. */
  taken: TakenPerk[];
  /** Levels whose choice is still open, oldest first. */
  pending: number[];
}

export const PERKS_SLICE = 'perks';

registerStateSlice<PerksState>(PERKS_SLICE, () => ({ seed: null, taken: [], pending: [] }));

const isLevel = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= FIRST_PERK_LEVEL && (n as number) <= MAX_LEVEL;

/** The slice, repaired if a save holds something malformed: known perks, one per level, no perk twice. */
export function perksOf(state: GameState): PerksState {
  const p = getSlice<PerksState>(state, PERKS_SLICE);
  if (!(Number.isInteger(p.seed) && (p.seed as number) >= 0)) p.seed = null;
  const levels = new Set<number>();
  const ids = new Set<string>();
  const taken: unknown[] = Array.isArray(p.taken) ? p.taken : [];
  const keep = taken.filter((t): t is TakenPerk => {
    if (!isPlainObject(t) || !isLevel(t.level) || typeof t.id !== 'string' || !getPerk(t.id) || levels.has(t.level) || ids.has(t.id)) return false;
    levels.add(t.level);
    ids.add(t.id);
    return true;
  });
  if (!Array.isArray(p.taken) || keep.length !== taken.length) p.taken = keep;
  const pending = Array.isArray(p.pending) ? p.pending : [];
  const clean = [...new Set(pending.filter((l) => isLevel(l) && !levels.has(l)))].sort((a, b) => a - b);
  if (!Array.isArray(p.pending) || clean.length !== pending.length || clean.some((l, i) => l !== pending[i])) p.pending = clean;
  return p;
}

/**
 * What a perk gives this farm: its value once taken, else its neutral value (1 for a multiplier, 0 for points).
 * Cheap: called in the rules' hot paths.
 */
export function perkFactor(state: Pick<GameState, 'ext'>, id: PerkId): number {
  const def = getPerk(id)!;
  const p = state.ext[PERKS_SLICE] as PerksState | undefined;
  return p && Array.isArray(p.taken) && p.taken.some((t) => t?.id === id) ? def.value : def.neutral;
}

export function hasPerk(state: Pick<GameState, 'ext'>, id: PerkId): boolean {
  const def = getPerk(id)!;
  return perkFactor(state, id) !== def.neutral;
}

/** A building's material cost with Thrifty: each material 20% fewer, rounded up, at least 1. */
export function materialsCost(state: Pick<GameState, 'ext'>, cost: MaterialCost | undefined): MaterialCost {
  const f = perkFactor(state, 'thrifty');
  const out: MaterialCost = {};
  for (const [id, qty] of materialEntries(cost)) out[id] = f === 1 ? qty : Math.max(1, Math.ceil(qty * f - 1e-9));
  return out;
}

/** Game ms of building work for `type` on this farm (Master builder makes it faster); 0 when it needs no farmer. */
export function buildTime(state: Pick<GameState, 'ext'>, type: string): number {
  return Math.round(buildWorkMs(type) * perkFactor(state, 'master-builder'));
}

/** A 32-bit mix of the seed and the level (murmur3 finaliser), so neighbouring levels draw very different cards. */
function mix(seed: number, level: number): number {
  let h = (seed ^ Math.imul(level, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32: a small seeded generator, values in [0, 1). */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The whole pool in the order the choice at `level` draws from it: fixed by the farm's seed and the level. */
export function perkOrder(seed: number, level: number): PerkDef[] {
  const order = [...PERKS];
  const rand = generator(mix(seed, level));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Can the farm be offered `def`: not taken, and its subject (animals, processing, resources) is on the farm? */
function offerable(state: GameState, def: PerkDef, taken: Set<string>): boolean {
  if (taken.has(def.id)) return false;
  return !def.subjects || state.objects.some((o) => def.subjects!.includes(o.type));
}

/**
 * The cards of the choice at `level`: the first three perks in the level's seeded order (`perkOrder`) that are
 * neither taken nor about something the farm doesn't have yet (no Husbandry before a pen). The same farm always gets
 * the same cards; taking a perk elsewhere, or a first pen, only swaps the card it concerns.
 */
export function offerFor(state: GameState, level: number): PerkDef[] {
  const p = perksOf(state);
  const taken = new Set(p.taken.map((t) => t.id));
  return perkOrder(p.seed ?? 0, level)
    .filter((d) => offerable(state, d, taken))
    .slice(0, PERK_OFFERS);
}

/** Opens the choice of `level` (a level-up). No-op below level 2, or when the level is already chosen or open. */
export function queueChoice(state: GameState, level: number): void {
  const p = perksOf(state);
  if (!isLevel(level) || p.pending.includes(level) || p.taken.some((t) => t.level === level)) return;
  p.pending.push(level);
  p.pending.sort((a, b) => a - b);
}

export type ChooseResult = { ok: true; perk: PerkDef } | { ok: false; reason: 'not-pending' | 'not-offered' };

/** Takes perk `id` for the open choice of `level`. Refused (nothing changes) unless it is one of that choice's cards. */
export function choosePerk(state: GameState, level: number, id: string): ChooseResult {
  const p = perksOf(state);
  if (!p.pending.includes(level)) return { ok: false, reason: 'not-pending' };
  const perk = offerFor(state, level).find((d) => d.id === id);
  if (!perk) return { ok: false, reason: 'not-offered' };
  p.taken.push({ level, id: perk.id });
  p.pending = p.pending.filter((l) => l !== level);
  return { ok: true, perk };
}

/**
 * Sets the farm up for perks once: a seed, and for a farm already above level 1 (a save from before perks) one open
 * choice per level it has reached. Does nothing for a farm that has its seed.
 */
export function initPerks(state: GameState, level: number, random: () => number = Math.random): void {
  const p = perksOf(state);
  if (p.seed !== null) return;
  p.seed = Math.floor(random() * 0x100000000) >>> 0;
  for (let l = FIRST_PERK_LEVEL; l <= level; l++) queueChoice(state, l);
}

/** Debug: forgets every perk taken and opens a choice for every level reached. The seed stays. */
export function resetPerks(state: GameState, level: number): void {
  const p = perksOf(state);
  p.taken = [];
  p.pending = [];
  for (let l = FIRST_PERK_LEVEL; l <= level; l++) queueChoice(state, l);
}

/** The farm's perks, kept up with level-ups: every new level from 2 opens a choice. */
export class Perks {
  constructor(private readonly game: Game) {
    game.events.on('levelUp', ({ level }) => {
      queueChoice(game.state, level);
      this.changed();
    });
    game.events.on('reset', () => this.init());
    this.init();
  }

  private init(): void {
    initPerks(this.game.state, this.game.level);
  }

  private changed(): void {
    this.game.events.emit('perks', perksOf(this.game.state));
  }

  get taken(): readonly TakenPerk[] {
    return perksOf(this.game.state).taken;
  }

  /** Levels whose choice is still open, oldest first. */
  get pending(): readonly number[] {
    return perksOf(this.game.state).pending;
  }

  offer(level: number): PerkDef[] {
    return offerFor(this.game.state, level);
  }

  choose(level: number, id: string): ChooseResult {
    const result = choosePerk(this.game.state, level, id);
    if (result.ok) this.changed();
    return result;
  }

  /** Debug: forgets every perk taken; every level reached gets its choice back. */
  reset(): void {
    resetPerks(this.game.state, this.game.level);
    this.changed();
  }
}
