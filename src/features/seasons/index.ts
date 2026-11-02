import Phaser from 'phaser';
import { SEASON_INFO, type Season } from '../../data/seasons';
import type { FarmContext } from '../../game/context';
import { onGameStart, registerDebugInfo, registerSettingsSection } from '../../game/hooks';
import { harshWinterAt } from '../../logic/hazards';
import { dayOfSeason, nextSeasonAt, seasonOf } from '../../logic/seasons';
import { baseArt } from '../../scenes/art';
import { artSeason, setArtSeason, textureKey } from '../../scenes/sprites';
import { h } from '../../ui/dom';
import { CROSSFADE_MS, isNaturalChange, isIdentity, SEASON_LOOK, weatherBudget } from './look';
import { loadWeatherSettings, saveWeatherSettings, type SettingsStorage } from './settings';
import { WEATHER_SCENE, WeatherScene } from './weather';

/**
 * Seasons: a toast when one begins, the farm drawn in the season's look, and `window.farm.season` for QA. The rules
 * (what can be ploughed and sown when) live in `src/logic/crops.ts` and `src/logic/seasons.ts`; the HUD shows the
 * season next to the day.
 *
 * The look: every pack sprite drawn through `textureKey`/`addArt` comes in the season being drawn (`seasonalArt` in
 * `src/scenes/art.ts`), plus a colour grade and background on the farm camera and weather particles over it. It
 * follows `seasonOf(clock)`: at once on load, New game and clock jumps (debug "Next season", time away), with a
 * short crossfade when the season comes round while playing. Nothing runs per frame but a season check and the
 * particles.
 */

function settingsStorage(): SettingsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const storage = settingsStorage();
const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let weatherSettings = loadWeatherSettings(storage, reducedMotion);
const weather = new WeatherScene();

/** Swaps every seasonal texture in the scene for the version of the season being drawn (the Farm scene repaints its ground itself). */
function retexture(scene: Phaser.Scene): void {
  const visit = (objects: Phaser.GameObjects.GameObject[]) => {
    for (const o of objects) {
      if (o instanceof Phaser.GameObjects.Container) {
        visit(o.list);
      } else if (o instanceof Phaser.GameObjects.Image) {
        const key = o.texture.key;
        const next = textureKey(scene, baseArt(key));
        if (next !== key && next !== 'missing') o.setTexture(next);
      }
    }
  };
  visit(scene.children.list);
}

/** The camera side of the look: background and colour grade. */
function grade(scene: Phaser.Scene, season: Season, filter: { active: boolean; colorMatrix: { set(v: number[]): unknown } } | null): void {
  const look = SEASON_LOOK[season];
  scene.cameras.main.setBackgroundColor(look.background);
  if (!filter) return;
  filter.active = look.grade !== null && !isIdentity(look.grade);
  if (look.grade) filter.colorMatrix.set([...look.grade]);
}

/**
 * Covers the canvas with a snapshot of the old look, switches underneath and fades the snapshot out. Falls back to
 * switching at once where there is no snapshot.
 */
function crossfade(scene: Phaser.Scene, apply: () => void, done: () => void): void {
  const parent = scene.game.canvas.parentElement;
  const renderer = scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer | Phaser.Renderer.Canvas.CanvasRenderer;
  if (!parent || typeof renderer.snapshot !== 'function') {
    apply();
    done();
    return;
  }
  renderer.snapshot(
    (img) => {
      apply();
      if (!(img instanceof HTMLImageElement)) return done();
      img.className = 'season-fade';
      img.setAttribute('aria-hidden', 'true');
      img.style.transition = `opacity ${CROSSFADE_MS}ms ease-in-out`;
      parent.append(img);
      // Two frames: one so the new look is drawn under the snapshot, one so the transition starts from opacity 1.
      requestAnimationFrame(() => requestAnimationFrame(() => (img.style.opacity = '0')));
      window.setTimeout(() => {
        img.remove();
        done();
      }, CROSSFADE_MS + 100);
    },
    'image/jpeg',
    0.9,
  );
}

onGameStart((ctx) => {
  const { game } = ctx;
  const scene = ctx.scene;
  const cam = scene.cameras.main;
  const filter = (cam.filters?.internal.addColorMatrix() ?? null) as Parameters<typeof grade>[2];
  let drawn: Season = seasonOf(game.state.clock);
  let lastElapsed = game.state.clock.elapsed;
  let fading = false;

  const show = (season: Season) => {
    drawn = season;
    setArtSeason(season);
    retexture(scene);
    grade(scene, season, filter);
  };
  show(drawn);
  scene.scene.add(WEATHER_SCENE, weather, true);

  scene.events.on(Phaser.Scenes.Events.UPDATE, () => {
    const elapsed = game.state.clock.elapsed;
    const season = seasonOf(game.state.clock);
    if (season !== drawn && !fading) {
      if (isNaturalChange(lastElapsed, elapsed)) {
        fading = true;
        drawn = season; // so the check stays quiet while the snapshot is taken
        crossfade(scene, () => show(seasonOf(game.state.clock)), () => (fading = false));
      } else {
        show(season);
      }
    }
    lastElapsed = elapsed;
    const harsh = harshWinterAt(game.state, elapsed);
    weather.setWeather(drawn, weatherBudget(drawn, scene.scale.width, scene.scale.height, cam.zoom, weatherSettings.enabled, harsh));
  });

  registerDebugInfo('season', () => {
    const clock = game.state.clock;
    return {
      season: seasonOf(clock),
      dayOfSeason: dayOfSeason(clock),
      msLeft: nextSeasonAt(clock.elapsed) - clock.elapsed,
      /** The season the farm is drawn in. */
      look: artSeason(),
      /** Weather particles alive now. */
      weather: weather.count,
    };
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

registerSettingsSection({
  id: 'weather',
  render(_ctx: FarmContext, body: HTMLElement) {
    const toggle = h('input', {
      type: 'checkbox',
      id: 'weather-effects',
      'data-testid': 'weather-effects',
      checked: weatherSettings.enabled,
      onchange: () => {
        weatherSettings = { enabled: toggle.checked };
        saveWeatherSettings(storage, weatherSettings);
      },
    });
    body.append(
      h(
        'section',
        { class: 'weather-settings', 'data-testid': 'weather-settings' },
        h('h3', { class: 'group-title' }, 'Display'),
        h('label', { class: 'check-row', for: 'weather-effects' }, toggle, 'Weather effects (snow, leaves, petals)'),
      ),
    );
  },
});
