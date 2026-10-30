/** The four seasons, in order. The farm is founded on the first day of spring. */
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

export type Season = (typeof SEASONS)[number];

/** Game days per season: a year is 8 days (32 real minutes at ×1). */
export const SEASON_DAYS = 2;

export interface SeasonDef {
  name: string;
  icon: string;
  /** Shown in a toast when the season begins. */
  greeting: string;
}

export const SEASON_INFO: Record<Season, SeasonDef> = {
  spring: { name: 'Spring', icon: '🌸', greeting: 'The ground has thawed: plough your fields and sow!' },
  summer: { name: 'Summer', icon: '🌻', greeting: 'Long, warm days: carrots wait for the cool of autumn.' },
  autumn: { name: 'Autumn', icon: '🍂', greeting: 'Last chance to grow crops before the frost.' },
  winter: { name: 'Winter', icon: '❄️', greeting: 'The ground is frozen: no ploughing or sowing until spring.' },
};

/** Seasons in which fields can be ploughed. Ploughed soil stays ploughed until the first season outside these (the winter frost). */
export const PLOUGH_SEASONS: readonly Season[] = ['spring', 'summer', 'autumn'];

/** Money charged to plough a field. */
export const PLOUGH_COST = 5;

/** "Spring, Autumn" */
export function seasonNames(seasons: readonly Season[]): string {
  return seasons.map((s) => SEASON_INFO[s].name).join(', ');
}
