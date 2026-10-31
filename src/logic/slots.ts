import { dayOf } from './clock';
import { PROGRESSION, type ProgressionState } from './progression';
import { parseSave, SAVE_KEY, SAVE_VERSION, serialize, type LoadedSave, type SaveStorage } from './save';
import { seasonOf } from './seasons';
import type { Season } from '../data/seasons';
import { isPlainObject } from './slices';
import type { GameState } from './types';
import { levelForXp } from './unlocks';

/** Manual save slots, kept beside the autosave (`farmer.save`) in their own localStorage keys. */
export const SLOT_COUNT = 3;
export const SLOT_IDS = [1, 2, 3] as const;

/** `'auto'` is the autosave; 1–3 are the manual slots. */
export type SlotId = 'auto' | (typeof SLOT_IDS)[number];

export function slotKey(id: SlotId): string {
  return id === 'auto' ? SAVE_KEY : `farmer.slot.${id}`;
}

/** What a slot row shows. An empty (or unreadable) slot has only `id` and `empty: true`. */
export type SlotSummary =
  | { id: SlotId; empty: true }
  | {
      id: SlotId;
      empty: false;
      day: number;
      season: Season;
      level: number;
      money: number;
      /** Real time (`Date.now()`) the slot was written; null for saves too old to know. */
      savedAt: number | null;
    };

export function summarize(id: SlotId, { state, savedAt }: LoadedSave): SlotSummary {
  const xp = (state.ext[PROGRESSION] as ProgressionState | undefined)?.xp ?? 0;
  return { id, empty: false, day: dayOf(state.clock), season: seasonOf(state.clock), level: levelForXp(xp), money: state.money, savedAt };
}

/** Why a save file was refused, in words for the player. */
export class SaveFileError extends Error {}

/**
 * Parses a save strictly, for slots and imported files. Unlike `parseSave` (a broken autosave silently becomes a new
 * game), anything that is not a farm save of this or an older version throws a `SaveFileError`. Older versions migrate.
 */
export function parseSaveFile(json: string): LoadedSave {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SaveFileError('This file is not a Farmer save (it is not JSON).');
  }
  if (!isPlainObject(raw)) throw new SaveFileError('This file is not a Farmer save.');
  // Version 0 had the game state at the top level and no version.
  const version = raw.version === undefined ? 0 : raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) throw new SaveFileError('This file is not a Farmer save.');
  if (version > SAVE_VERSION) throw new SaveFileError('This save comes from a newer version of Farmer.');
  const state = version === 0 ? raw : raw.state;
  if (!looksLikeState(state)) throw new SaveFileError('This file is not a Farmer save.');
  return parseSave(json);
}

function looksLikeState(v: unknown): boolean {
  return isPlainObject(v) && typeof v.money === 'number' && Array.isArray(v.objects) && isPlainObject(v.clock);
}

/** Reads a slot (or the autosave). Null when it is empty, unreadable or storage is blocked. */
export function readSlot(storage: SaveStorage, id: SlotId): LoadedSave | null {
  let json: string | null;
  try {
    json = storage.getItem(slotKey(id));
  } catch {
    return null;
  }
  if (json === null) return null;
  try {
    return parseSaveFile(json);
  } catch {
    return null;
  }
}

/** The raw save text of a slot, for export. Null when empty. */
export function readSlotText(storage: SaveStorage, id: SlotId): string | null {
  try {
    return readSlot(storage, id) ? storage.getItem(slotKey(id)) : null;
  } catch {
    return null;
  }
}

/** The autosave and the manual slots, in that order. */
export function listSlots(storage: SaveStorage): SlotSummary[] {
  return (['auto', ...SLOT_IDS] as SlotId[]).map((id) => {
    const loaded = readSlot(storage, id);
    return loaded ? summarize(id, loaded) : { id, empty: true };
  });
}

export type WriteResult = { ok: true } | { ok: false; error: string };

export const STORAGE_FULL = 'Could not save: browser storage is full or blocked.';

/** Writes a farm into a slot. Never throws: a full or blocked storage is reported, and nothing else changes. */
export function writeSlot(storage: SaveStorage, id: SlotId, state: GameState, savedAt: number | null = Date.now()): WriteResult {
  try {
    storage.setItem(slotKey(id), serialize(state, savedAt));
    return { ok: true };
  } catch {
    return { ok: false, error: STORAGE_FULL };
  }
}

export function deleteSlot(storage: SaveStorage, id: SlotId): void {
  try {
    storage.removeItem(slotKey(id));
  } catch {
    // Blocked storage holds nothing to delete.
  }
}

/**
 * Imports a save file into a manual slot, migrated to the current version. A file that is not a farm save is refused
 * (`ok: false`) and the slot is left as it was.
 */
export function importSlot(storage: SaveStorage, id: SlotId, json: string): WriteResult {
  let loaded: LoadedSave;
  try {
    loaded = parseSaveFile(json);
  } catch (e) {
    return { ok: false, error: e instanceof SaveFileError ? e.message : 'This file could not be read.' };
  }
  return writeSlot(storage, id, loaded.state, loaded.savedAt);
}

/** `farmer-save-2026-10-31.json` (local date). */
export function exportFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `farmer-save-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
