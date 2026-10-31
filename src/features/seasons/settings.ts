/**
 * The "Weather effects" setting lives in localStorage, not in the save file, like the sound settings: it belongs
 * to the browser rather than the farm. Without a saved choice it is on, unless the system asks for reduced motion.
 */
export const WEATHER_SETTINGS_KEY = 'farmer.weather';

export interface WeatherSettings {
  enabled: boolean;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadWeatherSettings(storage: SettingsStorage | null, reducedMotion: boolean): WeatherSettings {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(WEATHER_SETTINGS_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && typeof (saved as WeatherSettings).enabled === 'boolean') {
      return { enabled: (saved as WeatherSettings).enabled };
    }
  } catch {
    // Broken JSON or blocked storage: the default.
  }
  return { enabled: !reducedMotion };
}

export function saveWeatherSettings(storage: SettingsStorage | null, settings: WeatherSettings): void {
  try {
    storage?.setItem(WEATHER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked: the setting just does not persist.
  }
}
