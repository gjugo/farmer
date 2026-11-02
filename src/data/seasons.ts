/** The four seasons, in order. The farm is founded on the first day of spring. */
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

export type Season = (typeof SEASONS)[number];

/** Game days per season: a season is 32 real minutes at ×1, a year 16 days (about 2 hours). */
export const SEASON_DAYS = 4;

export interface SeasonDef {
  name: string;
  icon: string;
  /** Shown in a toast when the season begins. */
  greeting: string;
}

export const SEASON_INFO: Record<Season, SeasonDef> = {
  spring: { name: 'Spring', icon: '🌸', greeting: 'The ground has thawed: plough your fields and sow! Corn needs half a season, so sow it early.' },
  summer: { name: 'Summer', icon: '🌻', greeting: 'Long, warm days for wheat and corn: carrots wait for the cool of autumn.' },
  autumn: { name: 'Autumn', icon: '🍂', greeting: 'Last chance to grow crops before the frost: sow early, a late crop will not ripen in time. Cabbage sown now grows on into winter.' },
  winter: { name: 'Winter', icon: '❄️', greeting: 'The ground is frozen: no ploughing or sowing until spring. Cabbage sown in autumn still ripens.' },
};

/** Seasons in which fields can be ploughed. Ploughed soil stays ploughed until the first season outside these (the winter frost). */
export const PLOUGH_SEASONS: readonly Season[] = ['spring', 'summer', 'autumn'];

/** "Spring, Autumn" */
export function seasonNames(seasons: readonly Season[]): string {
  return seasons.map((s) => SEASON_INFO[s].name).join(', ');
}
