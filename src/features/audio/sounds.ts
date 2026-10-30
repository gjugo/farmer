import type { ActivityEvents } from '../../logic/activity';
import type { GameEvents } from '../../logic/game';
import type { UiSignals } from '../../game/signals';

/**
 * The sound catalogue and which game moment plays which sound. Pure data and
 * functions (no Web Audio), so the mapping is unit-tested.
 */

/** Short effects, decoded up front. `volume` evens out the recordings (0–1). */
export const SFX = {
  click: { volume: 0.5 },
  build: { volume: 0.8 },
  demolish: { volume: 0.8 },
  plant: { volume: 0.8 },
  harvest: { volume: 0.8 },
  buy_animal: { volume: 0.8 },
  feed: { volume: 0.8 },
  collect_egg: { volume: 0.8 },
  collect_milk: { volume: 0.8 },
  collect_wool: { volume: 0.8 },
  process_start: { volume: 0.7 },
  process_done: { volume: 0.7 },
  coins: { volume: 0.8 },
  order: { volume: 0.8 },
  goal: { volume: 0.8 },
  levelup: { volume: 0.8 },
  land: { volume: 0.8 },
  refused: { volume: 0.6 },
  welcome: { volume: 0.7 },
  cluck: { volume: 0.5 },
  cluck2: { volume: 0.5 },
  moo: { volume: 0.5 },
  moo2: { volume: 0.5 },
  baa: { volume: 0.5 },
  baa2: { volume: 0.5 },
} as const satisfies Record<string, { volume: number }>;

export type SfxKey = keyof typeof SFX;

/** The outdoor ambience loop (birds, light wind). */
export const AMBIENCE = 'ambience';

/** Calm acoustic tracks, played one after another. */
export const MUSIC = ['music2', 'music1', 'music3'] as const;

/** Every audio file lives at `audio/<key>.mp3` (MP3 plays in Chrome, Firefox and Safari, desktop and iOS). */
export function audioUrl(key: string): string {
  return `audio/${key}.mp3`;
}

/** What each animal says (a few recordings each). */
export const ANIMAL_SOUNDS: Record<string, readonly SfxKey[]> = { chicken: ['cluck', 'cluck2'], cow: ['moo', 'moo2'], sheep: ['baa', 'baa2'] };

/** Product collected from a pen → its sound. */
const COLLECT_SOUNDS: Record<string, SfxKey> = { egg: 'collect_egg', milk: 'collect_milk', wool: 'collect_wool' };

type SoundMap<E> = { [K in keyof E]?: (payload: E[K]) => SfxKey | null };

/** Player activity → sound. */
export const ACTIVITY_SOUNDS: SoundMap<ActivityEvents> = {
  placed: () => 'build',
  planted: () => 'plant',
  harvested: () => 'harvest',
  animalBought: () => 'buy_animal',
  fed: () => 'feed',
  collected: ({ item }) => COLLECT_SOUNDS[item] ?? 'harvest',
  made: () => 'harvest',
  jobStarted: () => 'process_start',
  jobsFinished: () => 'process_done',
  sold: () => 'coins',
  orderFulfilled: () => 'order',
  goalClaimed: () => 'goal',
  landBought: () => 'land',
};

/** Game state events → sound. Only events that are always the player's doing (or a milestone) are here. */
export const GAME_EVENT_SOUNDS: SoundMap<GameEvents> = {
  objectRemoved: () => 'demolish',
  levelUp: () => 'levelup',
};

/** UI moments → sound. */
export const UI_SOUNDS: SoundMap<UiSignals> = {
  refused: () => 'refused',
  welcomeBack: () => 'welcome',
};

/** Looks up the sound for `event` in `map`; null when it has none. */
export function soundFor<E, K extends keyof E>(map: SoundMap<E>, event: K, payload: E[K]): SfxKey | null {
  return map[event]?.(payload) ?? null;
}

/** Real milliseconds between two animal sounds across the whole farm. */
export const ANIMAL_GAP_MS = { min: 8_000, max: 15_000 } as const;

/** Delay before the next animal sound, from a random number in [0, 1). */
export function nextAnimalDelay(random: number): number {
  return ANIMAL_GAP_MS.min + random * (ANIMAL_GAP_MS.max - ANIMAL_GAP_MS.min);
}

/**
 * Picks a voice of one animal kind present on the farm (each kind equally likely, whatever
 * the head count), or null when there are no animals. `random` is in [0, 1).
 */
export function pickAnimalSound(kinds: readonly string[], random: number): SfxKey | null {
  const choirs = [...new Set(kinds)].flatMap((k) => (ANIMAL_SOUNDS[k] ? [ANIMAL_SOUNDS[k]] : []));
  if (choirs.length === 0) return null;
  const scaled = random * choirs.length;
  const voices = choirs[Math.min(choirs.length - 1, Math.floor(scaled))];
  return voices[Math.min(voices.length - 1, Math.floor((scaled % 1) * voices.length))];
}
