/**
 * Sound settings live in localStorage, not in the save file, so they belong to the
 * browser rather than the farm and never change the save version.
 */
export const AUDIO_SETTINGS_KEY = 'farmer.audio';

export interface AudioSettings {
  muted: boolean;
  /** 0–100. */
  musicVolume: number;
  /** 0–100. Also scales the ambience. */
  sfxVolume: number;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = { muted: false, musicVolume: 30, sfxVolume: 80 };

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function volume(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v))) : fallback;
}

/** Reads the settings; anything missing or broken falls back to the defaults. */
export function loadAudioSettings(storage: SettingsStorage | null): AudioSettings {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(AUDIO_SETTINGS_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
  } catch {
    // Broken JSON: defaults.
  }
  const d = DEFAULT_AUDIO_SETTINGS;
  return {
    muted: typeof saved.muted === 'boolean' ? saved.muted : d.muted,
    musicVolume: volume(saved.musicVolume, d.musicVolume),
    sfxVolume: volume(saved.sfxVolume, d.sfxVolume),
  };
}

export function saveAudioSettings(storage: SettingsStorage | null, settings: AudioSettings): void {
  try {
    storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked: the settings just do not persist.
  }
}

/** Slider value (0–100) → gain. Squared, so the slider feels even to the ear. */
export function sliderGain(value: number): number {
  const v = Math.min(100, Math.max(0, value)) / 100;
  return v * v;
}
