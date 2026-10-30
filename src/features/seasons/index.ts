import { SEASON_INFO } from '../../data/seasons';
import { onGameStart, registerDebugInfo } from '../../game/hooks';
import { dayOfSeason, nextSeasonAt, seasonOf } from '../../logic/seasons';

/**
 * Seasons: a toast when one begins, and `window.farm.season` for QA. The rules (what can be ploughed
 * and sown when) live in `src/logic/crops.ts` and `src/logic/seasons.ts`; the HUD shows the season next to the day.
 */

onGameStart((ctx) => {
  const { game } = ctx;
  registerDebugInfo('season', () => {
    const clock = game.state.clock;
    return { season: seasonOf(clock), dayOfSeason: dayOfSeason(clock), msLeft: nextSeasonAt(clock.elapsed) - clock.elapsed };
  });
  let last = seasonOf(game.state.clock);
  game.events.on('day', () => {
    const season = seasonOf(game.state.clock);
    if (season === last) return;
    last = season;
    const info = SEASON_INFO[season];
    ctx.ui.toast(`${info.icon} ${info.name} has begun. ${info.greeting}`);
  });
  game.events.on('reset', () => (last = seasonOf(game.state.clock)));
});
