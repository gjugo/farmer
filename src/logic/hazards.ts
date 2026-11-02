import { ANIMALS } from '../data/animals';
import { getBuildable } from '../data/buildables';
import { FIELD, getCrop } from '../data/crops';
import { COTTAGE, FARMHOUSE_HOMES, FIREWOOD_PER_HOME } from '../data/families';
import {
  CROWS,
  DEFENCE_FOR,
  DEFENCES,
  DROUGHT,
  FOX,
  HARSH_WINTER,
  HAZARD_INFO,
  HAZARD_LOG_MAX,
  QUIET_DAYS,
  type DefenceType,
  type HazardKind,
} from '../data/hazards';
import { SEASON_DAYS } from '../data/seasons';
import { animalsOf, isPenType, type PenState } from './animals';
import { DAY_MS } from './constants';
import type { FieldState } from './crops';
import type { Game } from './game';
import { nextSeasonAt, nextSeasonIn, seasonAt, SEASON_MS } from './seasons';
import { getSlice, isPlainObject, registerStateSlice } from './slices';
import type { GameState, PlacedObject } from './types';
import { workersOf } from './workers';

/**
 * Hazards: harsh winters, droughts, crows and foxes, each with a defence (numbers in `src/data/hazards.ts`).
 *
 * They are decided deterministically from the farm's saved `seed` and the game time, inside the work scheduler
 * (`src/logic/work.ts`): at every day boundary the day is planned (announcements, and whether crows or a fox come and
 * when), and every planned moment is a scheduler event. So ×1, ×60, reloads and offline catch-up give the same farm.
 * What the farm is like at that moment (its level, its fields, coops and defences) decides the outcome.
 *
 * Fairness: nothing in a new farm's first season, at most one new event a day, losses never take money, and a fox
 * never takes the farm's last chicken. A harsh winter only doubles the firewood the families need, so the existing
 * firewood approval rules do the rest (`src/logic/families.ts`).
 */

export const HAZARDS = 'hazards';

let enabled = true;

/**
 * Turns hazards on or off for every farm (on by default). Tests that are not about hazards run with them off (see
 * `src/test-setup.ts`), so a random seed never decides their outcome; hazard and balance tests turn them on.
 */
export function setHazardsEnabled(on: boolean): void {
  enabled = on;
}

/** An event that is on now (`current`) or announced and coming (`upcoming`). */
export interface HazardEvent {
  kind: HazardKind;
  /** Game time it starts (crows land, the fox comes) and ends; a fox's visit is a moment (`end` = `start`). */
  start: number;
  end: number;
  /** When it was announced (a harsh winter at the start of autumn, a drought a day ahead); missing for crows and foxes. */
  announcedAt?: number;
  /** Crows: the field they eat. */
  target?: string;
}

export type HazardOutcome = 'warning' | 'started' | 'loss' | 'defended' | 'ended';

/** One line of the hazard log, newest first. Also the payload of the `hazard` activity event. */
export interface HazardNote {
  at: number;
  kind: HazardKind;
  outcome: HazardOutcome;
  /** The toast and log text, e.g. "Crows ate 3 wheat on a field". */
  text: string;
  /** The field or coop it hit (or that was defended). */
  target?: string;
  /** What was lost, e.g. `{ chicken: 1 }` or `{ wheat: 3 }`. */
  lost?: Record<string, number>;
}

export interface HazardsState {
  /** Decides every roll. Saved, so a reload gives the same events. */
  seed: number;
  /** The last game day planned; -1 before the first step. */
  plannedDay: number;
  current: HazardEvent[];
  upcoming: HazardEvent[];
  log: HazardNote[];
}

function newSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

function initialHazards(): HazardsState {
  return { seed: newSeed(), plannedDay: -1, current: [], upcoming: [], log: [] };
}

registerStateSlice<HazardsState>(HAZARDS, initialHazards);

const KINDS = new Set<string>(Object.keys(HAZARD_INFO));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanEvent(v: unknown): HazardEvent | null {
  if (!isPlainObject(v) || !KINDS.has(v.kind as string) || !isNum(v.start) || !isNum(v.end)) return null;
  const e: HazardEvent = { kind: v.kind as HazardKind, start: v.start, end: v.end };
  if (isNum(v.announcedAt)) e.announcedAt = v.announcedAt;
  if (typeof v.target === 'string') e.target = v.target;
  return e;
}

/** The hazards slice, repaired if a save holds something malformed. */
export function hazardsOf(state: GameState): HazardsState {
  const raw = getSlice<unknown>(state, HAZARDS);
  const s = (isPlainObject(raw) ? raw : {}) as Partial<HazardsState>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(cleanEvent).filter((e): e is HazardEvent => e !== null) : []);
  const fixed: HazardsState = {
    seed: Number.isInteger(s.seed) && s.seed! >= 0 ? s.seed! : newSeed(),
    plannedDay: Number.isInteger(s.plannedDay) && s.plannedDay! >= -1 ? s.plannedDay! : -1,
    current: list(s.current),
    upcoming: list(s.upcoming),
    log: Array.isArray(s.log) ? s.log.filter((n): n is HazardNote => isPlainObject(n) && isNum(n.at) && KINDS.has(n.kind as string) && typeof n.text === 'string') : [],
  };
  if (!isPlainObject(raw)) return (state.ext[HAZARDS] = fixed);
  return Object.assign(raw, fixed) as HazardsState;
}

// Rolls ------------------------------------------------------------------------------

const TAGS = { winter: 1, drought: 2, droughtDay: 3, crows: 4, crowsAt: 5, crowsField: 6, fox: 7, foxAt: 8, foxCoop: 9 } as const;

/** A roll in [0, 1) for the farm's seed, a tag and a number (a day or a year): the same inputs always give the same roll. */
export function roll(seed: number, tag: keyof typeof TAGS, n: number): number {
  let h = (seed ^ Math.imul(TAGS[tag], 0x9e3779b1) ^ Math.imul(n + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x1_0000_0000;
}

const YEAR_DAYS = SEASON_DAYS * 4;

/** First game day of `season` (0 spring … 3 winter) in year `year`. */
const seasonDay = (year: number, season: number) => year * YEAR_DAYS + season * SEASON_DAYS;

// Coverage ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function areaOf(obj: PlacedObject): Rect {
  return { x: obj.x, y: obj.y, ...(getBuildable(obj.type)?.footprint ?? { w: 1, h: 1 }) };
}

/** Does a defence standing on `d` with reach `range` cover any tile of `a`? Measured from edge to edge, in tiles. */
export function reaches(d: Rect, range: number, a: Rect): boolean {
  const dx = Math.max(0, a.x - (d.x + d.w - 1), d.x - (a.x + a.w - 1));
  const dy = Math.max(0, a.y - (d.y + d.h - 1), d.y - (a.y + a.h - 1));
  return dx * dx + dy * dy <= range * range;
}

/** The finished defences of `type` that cover `area`. */
export function defendersOf(state: GameState, type: DefenceType, area: Rect): PlacedObject[] {
  const range = DEFENCES[type].range;
  return state.objects.filter((o) => o.type === type && !o.site && reaches(areaOf(o), range, area));
}

/** Is the field or coop guarded against `kind`? A harsh winter has no building to guard against it. */
export function isProtected(state: GameState, obj: PlacedObject, kind: HazardKind): boolean {
  const type = DEFENCE_FOR[kind];
  return !!type && defendersOf(state, type, areaOf(obj)).length > 0;
}

/** The defences covering tile (x, y), e.g. `['well', 'scarecrow']`: for `window.farm.hazards.coverage`. */
export function coverage(state: GameState, x: number, y: number): DefenceType[] {
  return (Object.keys(DEFENCES) as DefenceType[]).filter((t) => defendersOf(state, t, { x, y, w: 1, h: 1 }).length > 0);
}

// The farm ---------------------------------------------------------------------------

/** A field with a crop still growing at `now`. */
function growing(obj: PlacedObject, now: number): boolean {
  if (obj.type !== FIELD || obj.site) return false;
  const s = obj.state as FieldState;
  return !!s.crop && !!s.timer && now < s.timer.start + s.timer.duration;
}

/** Coops with chickens in them, in build order. */
function coopsWithChickens(state: GameState): PlacedObject<PenState>[] {
  return (state.objects.filter((o) => isPenType(o.type) && !o.site) as PlacedObject<PenState>[]).filter((o) =>
    animalsOf(o).some((a) => a.kind === 'chicken'),
  );
}

/** Chickens on the farm. */
export function chickensOf(state: GameState): number {
  return state.objects.reduce((n, o) => n + (isPenType(o.type) ? animalsOf(o as PlacedObject<PenState>).filter((a) => a.kind === 'chicken').length : 0), 0);
}

/** Occupied homes (as the families count them). */
function warmHomes(state: GameState): number {
  const homes = FARMHOUSE_HOMES + state.objects.filter((o) => o.type === COTTAGE && !o.site).length;
  return Math.min(homes, workersOf(state).farmers);
}

// Effects ----------------------------------------------------------------------------

/** The event of `kind` on at game time `t` (current, or announced and begun), if any. */
function eventAt(state: GameState, kind: HazardKind, t: number): HazardEvent | undefined {
  const s = hazardsOf(state);
  return [...s.current, ...s.upcoming].find((e) => e.kind === kind && e.start <= t && t < e.end);
}

/** Is a harsh winter on at game time `t`? */
export function harshWinterAt(state: GameState, t: number): boolean {
  return !!eventAt(state, 'harsh-winter', t);
}

/** Wood each occupied home burns on the winter day starting at `t`: twice as much in a harsh winter. */
export function firewoodPerHome(state: GameState, t: number): number {
  return FIREWOOD_PER_HOME * (harshWinterAt(state, t) ? HARSH_WINTER.firewoodFactor : 1);
}

/** The drought on at game time `t`, if any. */
export function droughtAt(state: GameState, t: number): HazardEvent | undefined {
  return eventAt(state, 'drought', t);
}

/** Is the field parched now: a drought is on and no well reaches it? (For its look and panel.) */
export function isParched(state: GameState, obj: PlacedObject, t: number): boolean {
  return obj.type === FIELD && !!droughtAt(state, t) && !isProtected(state, obj, 'drought');
}

/**
 * Game ms a crop needs to grow `remaining` more from `now`, through a drought ending at `end`: at `DROUGHT.growth`
 * speed until then, normal speed after.
 */
export function droughtRemaining(remaining: number, now: number, end: number): number {
  const slow = Math.max(0, end - now);
  const slowWork = slow * DROUGHT.growth;
  return remaining <= slowWork ? remaining / DROUGHT.growth : slow + (remaining - slowWork);
}

/**
 * How long a crop sown in the field now takes to grow: longer while a drought is on and no well reaches it (and its
 * harvest is marked parched). Called by `plant` in `src/logic/crops.ts`.
 */
export function droughtGrowMs(state: GameState, obj: PlacedObject<FieldState>, now: number, growMs: number): number {
  const d = droughtAt(state, now);
  if (!d || isProtected(state, obj, 'drought')) return growMs;
  obj.state.parched = true;
  return droughtRemaining(growMs, now, d.end);
}

/** Slows a growing crop down for the rest of a drought ending at `end`; its progress so far stays as it is. */
function parch(obj: PlacedObject<FieldState>, now: number, end: number): void {
  const timer = obj.state.timer!;
  const done = timer.start + timer.duration;
  const p = timer.duration > 0 ? (now - timer.start) / timer.duration : 1;
  const remaining = droughtRemaining(done - now, now, end);
  const duration = remaining / (1 - p);
  obj.state.timer = { start: now - p * duration, duration };
  obj.state.parched = true;
}

/** The share of its harvest a field still gives: less when it was parched in a drought or crows ate there. */
export function harvestShare(field: FieldState): number {
  return (field.parched ? DROUGHT.yield : 1) * (field.pecked ? 1 - CROWS.take : 1);
}

// Notes ------------------------------------------------------------------------------

function note(game: Game, n: HazardNote): void {
  const s = hazardsOf(game.state);
  s.log.unshift(n);
  if (s.log.length > HAZARD_LOG_MAX) s.log.length = HAZARD_LOG_MAX;
  game.activity.emit('hazard', n);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Wood the farm needs for a harsh winter as it is housed now. */
export function harshWinterWood(state: GameState): number {
  return warmHomes(state) * FIREWOOD_PER_HOME * HARSH_WINTER.firewoodFactor * SEASON_DAYS;
}

// Planning ---------------------------------------------------------------------------

/**
 * Plans game day `day` at its first moment: announces a harsh winter (first day of autumn) or a drought (the day before
 * it starts), and picks whether crows or a fox come today and when. A day on which a drought or harsh winter begins
 * gets nothing else: at most one new event a day.
 */
function planDay(game: Game, day: number): void {
  const { state } = game;
  const s = hazardsOf(state);
  const t = day * DAY_MS;
  if (day < QUIET_DAYS) return;
  const year = Math.floor(day / YEAR_DAYS);

  if (day === seasonDay(year, 2) && game.level >= HARSH_WINTER.level && roll(s.seed, 'winter', year) < HARSH_WINTER.chance) {
    announceHarshWinter(game, seasonDay(year, 3) * DAY_MS);
  }
  const droughtDay = seasonDay(year, 1) + Math.floor(roll(s.seed, 'droughtDay', year) * DROUGHT.startDays);
  if (day === droughtDay - 1 && game.level >= DROUGHT.level && roll(s.seed, 'drought', year) < DROUGHT.chance) {
    announceDrought(game, droughtDay * DAY_MS, seasonDay(year, 2) * DAY_MS);
  }

  // Something big starts today: no crows or fox as well.
  if (s.upcoming.some((e) => e.start === t && (e.kind === 'drought' || e.kind === 'harsh-winter'))) return;
  const at = (tag: 'crowsAt' | 'foxAt') => t + Math.floor((0.15 + 0.7 * roll(s.seed, tag, day)) * DAY_MS);
  if (CROWS.seasons.includes(seasonAt(t)) && game.level >= CROWS.level && roll(s.seed, 'crows', day) < CROWS.chance) {
    s.upcoming.push({ kind: 'crows', start: at('crowsAt'), end: at('crowsAt') });
  } else if (chickensOf(state) > 0 && roll(s.seed, 'fox', day) < FOX.chance) {
    s.upcoming.push({ kind: 'fox', start: at('foxAt'), end: at('foxAt') });
  }
}

function announceHarshWinter(game: Game, start: number): void {
  const s = hazardsOf(game.state);
  if (s.upcoming.some((e) => e.kind === 'harsh-winter' && e.start === start)) return;
  s.upcoming.push({ kind: 'harsh-winter', start, end: start + SEASON_MS, announcedAt: game.now });
  const wood = harshWinterWood(game.state);
  note(game, {
    at: game.now,
    kind: 'harsh-winter',
    outcome: 'warning',
    text: `🥶 A harsh winter is coming: homes will burn ${HARSH_WINTER.firewoodFactor} wood a day. Stock ${wood} 🪵 wood for the ${plural(warmHomes(game.state), 'home')} before winter.`,
  });
}

function announceDrought(game: Game, start: number, end: number): void {
  const s = hazardsOf(game.state);
  if (s.upcoming.some((e) => e.kind === 'drought' && e.start === start)) return;
  s.upcoming.push({ kind: 'drought', start, end, announcedAt: game.now });
  note(game, {
    at: game.now,
    kind: 'drought',
    outcome: 'warning',
    text: '☀️ A drought is coming tomorrow: until the end of summer, fields without a 🪣 well within 4 tiles grow at half speed and yield 30% less.',
  });
}

// Events -----------------------------------------------------------------------------

function startDrought(game: Game, e: HazardEvent): void {
  const { state } = game;
  let hit = 0;
  for (const obj of state.objects) {
    if (!growing(obj, game.now) || isProtected(state, obj, 'drought')) continue;
    parch(obj as PlacedObject<FieldState>, game.now, e.end);
    game.touch(obj);
    hit++;
  }
  const growingFields = state.objects.filter((o) => growing(o, game.now)).length;
  note(game, {
    at: game.now,
    kind: 'drought',
    outcome: hit > 0 ? 'loss' : 'started',
    text:
      hit > 0
        ? `☀️ Drought! ${plural(hit, 'field')} without a well ${hit === 1 ? 'is' : 'are'} drying out: slower crops, 30% smaller harvests.`
        : growingFields > 0
          ? '☀️ Drought! Your wells keep every growing field watered.'
          : '☀️ Drought! Fields sown until the end of summer need a well nearby.',
  });
}

/** Crows land on one growing field (picked by the seed) and eat there, unless a scarecrow reaches it. */
function crowsLand(game: Game, day: number): HazardEvent | null {
  const { state } = game;
  const fields = state.objects.filter((o) => growing(o, game.now) && !(o.state as FieldState).pecked) as PlacedObject<FieldState>[];
  if (fields.length === 0) return null;
  const field = fields[Math.floor(roll(hazardsOf(state).seed, 'crowsField', day) * fields.length)];
  const crop = getCrop(field.state.crop!);
  const name = crop?.name.toLowerCase() ?? 'crop';
  if (isProtected(state, field, 'crows')) {
    note(game, { at: game.now, kind: 'crows', outcome: 'defended', target: field.id, text: `🐦‍⬛ Crows circled the ${name} field, but the scarecrow kept them off.` });
    return null;
  }
  field.state.pecked = true;
  game.touch(field);
  note(game, {
    at: game.now,
    kind: 'crows',
    outcome: 'loss',
    target: field.id,
    text: `🐦‍⬛ Crows landed on the ${name} field and ate ${Math.round(CROWS.take * 100)}% of its harvest. A scarecrow keeps them off.`,
  });
  return { kind: 'crows', start: game.now, end: game.now + CROWS.eatMs, target: field.id };
}

/** A fox comes to a coop (picked by the seed) and takes a chicken, unless a kennel reaches it or it is the farm's last. */
function foxComes(game: Game, day: number): void {
  const { state } = game;
  const coops = coopsWithChickens(state);
  if (coops.length === 0 || chickensOf(state) <= 1) return;
  const coop = coops[Math.floor(roll(hazardsOf(state).seed, 'foxCoop', day) * coops.length)];
  if (isProtected(state, coop, 'fox')) {
    note(game, { at: game.now, kind: 'fox', outcome: 'defended', target: coop.id, text: '🦊 A fox crept up to the coop, but the dog chased it off.' });
    return;
  }
  animalsOf(coop); // drops anything malformed, so the list below is the coop's own
  const list = coop.state.animals;
  // It takes the chicken nearest the fence: the last one bought.
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].kind !== 'chicken') continue;
    list.splice(i, 1);
    break;
  }
  game.touch(coop);
  note(game, {
    at: game.now,
    kind: 'fox',
    outcome: 'loss',
    target: coop.id,
    lost: { chicken: 1 },
    text: `🦊 A fox took a ${ANIMALS.chicken.icon} chicken from the coop. A kennel nearby keeps foxes away.`,
  });
}

/** Starts or resolves an upcoming event whose time has come. */
function begin(game: Game, e: HazardEvent): void {
  const s = hazardsOf(game.state);
  const day = Math.floor(e.start / DAY_MS);
  if (e.kind === 'drought') {
    s.current.push(e);
    startDrought(game, e);
  } else if (e.kind === 'harsh-winter') {
    s.current.push(e);
    note(game, {
      at: game.now,
      kind: 'harsh-winter',
      outcome: 'started',
      text: `🥶 The harsh winter has begun: every home burns ${HARSH_WINTER.firewoodFactor} wood a day.`,
    });
  } else if (e.kind === 'crows') {
    const eating = crowsLand(game, day);
    if (eating) s.current.push(eating);
  } else {
    foxComes(game, day);
  }
}

/**
 * The hazards' part of a scheduler step at the current game time: plans every day that has begun, then starts what is
 * due and ends what is over. Called by `runWork` at every event, so it must be a no-op between events.
 */
export function stepHazards(game: Game): void {
  const { state } = game;
  const now = state.clock.elapsed;
  const s = hazardsOf(state);
  const today = Math.floor(now / DAY_MS);
  // A new game, or a save from before hazards: start planning from tomorrow.
  if (s.plannedDay < 0) s.plannedDay = today;
  while (s.plannedDay < today) {
    s.plannedDay++;
    if (enabled) planDay(game, s.plannedDay);
  }

  for (;;) {
    const due = s.upcoming.filter((e) => e.start <= now).sort((a, b) => a.start - b.start)[0];
    if (!due) break;
    s.upcoming.splice(s.upcoming.indexOf(due), 1);
    begin(game, due);
  }
  for (const e of s.current.filter((c) => c.end <= now)) {
    s.current.splice(s.current.indexOf(e), 1);
    if (e.kind === 'drought') note(game, { at: now, kind: 'drought', outcome: 'ended', text: '🌧️ The drought is over.' });
    if (e.kind === 'harsh-winter') note(game, { at: now, kind: 'harsh-winter', outcome: 'ended', text: '🌤️ The harsh winter is over.' });
  }
}

/** The next game time after now at which the hazards' step does something: a planned event, one ending, or a new day. */
export function nextHazardEvent(state: GameState): number {
  const now = state.clock.elapsed;
  const s = hazardsOf(state);
  let next = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
  for (const e of s.upcoming) if (e.start > now && e.start < next) next = e.start;
  for (const e of s.current) if (e.end > now && e.end < next) next = e.end;
  return next;
}

// Debug triggers ---------------------------------------------------------------------

export type TriggerResult = { ok: true } | { ok: false; reason: string };

/**
 * Debug: makes a hazard happen now, skipping the rolls, the level and the season (a drought then lasts to the end of
 * the season). Defences still work, and a fox still never takes the last chicken. "Harsh winter" marks the next winter
 * (or this one) harsh.
 */
export function triggerHazard(game: Game, kind: HazardKind): TriggerResult {
  const { state } = game;
  const s = hazardsOf(state);
  const now = game.now;
  if (kind === 'drought') {
    if (droughtAt(state, now)) return { ok: false, reason: 'A drought is already on.' };
    begin(game, { kind, start: now, end: nextSeasonAt(now), announcedAt: now });
    return { ok: true };
  }
  if (kind === 'crows') {
    if (!state.objects.some((o) => growing(o, now) && !(o.state as FieldState).pecked)) return { ok: false, reason: 'No growing field for the crows.' };
    begin(game, { kind, start: now, end: now });
    return { ok: true };
  }
  if (kind === 'fox') {
    if (chickensOf(state) <= 1) return { ok: false, reason: 'The fox never takes the last chicken: keep at least 2.' };
    const before = s.log[0];
    begin(game, { kind, start: now, end: now });
    return s.log[0] !== before ? { ok: true } : { ok: false, reason: 'No coop with chickens.' };
  }
  const next = nextSeasonIn(now, ['winter']);
  const winter = next === now ? Math.floor(now / SEASON_MS) * SEASON_MS : next;
  if (harshWinterAt(state, winter)) return { ok: false, reason: 'That winter is already harsh.' };
  announceHarshWinter(game, winter);
  return { ok: true };
}
