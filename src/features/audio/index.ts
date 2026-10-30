import type { FarmContext, SheetSpec } from '../../game/context';
import { onGameStart, registerDebugInfo, registerHudButton, registerSettingsSection } from '../../game/hooks';
import { uiSignals, type UiSignals } from '../../game/signals';
import type { ActivityEvents } from '../../logic/activity';
import { animalsOf, isPenType, type PenState } from '../../logic/animals';
import type { GameEvents } from '../../logic/game';
import type { PlacedObject } from '../../logic/types';
import { h } from '../../ui/dom';
import { AUDIO_CREDITS } from './credits';
import { AudioEngine } from './engine';
import { loadAudioSettings, saveAudioSettings, type AudioSettings, type SettingsStorage } from './settings';
import {
  ACTIVITY_SOUNDS,
  AMBIENCE,
  audioUrl,
  GAME_EVENT_SOUNDS,
  MUSIC,
  nextAnimalDelay,
  pickAnimalSound,
  SFX,
  soundFor,
  UI_SOUNDS,
  type SfxKey,
} from './sounds';
import { SoundThrottle } from './throttle';

/**
 * Sound: effects for player actions, animal voices, an outdoor ambience and calm music.
 * Listens to `game.events`, `game.activity` and `uiSignals`; nothing else calls into it.
 * Audio starts on the first user gesture (browser autoplay rules).
 */

/** How many recent sound keys `window.farm.audio.lastPlayed` keeps. */
const LAST_PLAYED = 20;
/** Events whose activation lets a page start audio. */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

export interface AudioDebugInfo {
  muted: boolean;
  musicVolume: number;
  sfxVolume: number;
  /** The last sound keys played, oldest first. */
  lastPlayed: string[];
}

function settingsStorage(): SettingsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const storage = settingsStorage();
let settings: AudioSettings = loadAudioSettings(storage);
const engine = new AudioEngine(settings, audioUrl);
const throttle = new SoundThrottle();
const lastPlayed: string[] = [];
/** Bumped by every effect, so a button click that already made a sound plays no extra click. */
let playedCount = 0;

function updateSettings(change: Partial<AudioSettings>): void {
  settings = { ...settings, ...change };
  engine.setSettings(settings);
  saveAudioSettings(storage, settings);
}

/** Plays an effect (throttled) and records it for QA. Silent until the first gesture. */
function play(key: SfxKey): void {
  if (!engine.unlocked || document.visibilityState === 'hidden') return;
  if (!throttle.allow(key, performance.now(), engine.durationOf(key))) return;
  playedCount++;
  engine.play(key, SFX[key].volume);
  lastPlayed.push(key);
  if (lastPlayed.length > LAST_PLAYED) lastPlayed.shift();
}

registerDebugInfo('audio', (): AudioDebugInfo => Object.freeze({ ...settings, lastPlayed: Object.freeze([...lastPlayed]) as string[] }));

// Unlock -------------------------------------------------------------------------

function unlock(): void {
  // A touch pointerdown is not a user activation; creating the AudioContext then would log a warning.
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  const first = !engine.unlocked;
  engine.unlock();
  if (!first) return;
  for (const g of GESTURES) window.removeEventListener(g, unlock, true);
  engine.setAmbience(AMBIENCE);
  engine.startMusic(MUSIC);
}

// Wiring ---------------------------------------------------------------------------

function presentAnimalKinds(objects: readonly PlacedObject[]): string[] {
  return objects.filter((o) => isPenType(o.type)).flatMap((o) => animalsOf(o as unknown as PlacedObject<PenState>).map((a) => a.kind));
}

function scheduleAnimal(ctx: FarmContext): void {
  window.setTimeout(() => {
    const voice = pickAnimalSound(presentAnimalKinds(ctx.game.state.objects), Math.random());
    if (voice) play(voice);
    scheduleAnimal(ctx);
  }, nextAnimalDelay(Math.random()));
}

/** A click on a button that did nothing audible gets a soft tap; a tap on a disabled button is refused. */
function listenToButtons(root: HTMLElement): void {
  let before = 0;
  root.addEventListener('click', () => (before = playedCount), true);
  root.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest('button') && playedCount === before) play('click');
  });
  root.addEventListener('pointerup', (e) => {
    if ((e.target as Element | null)?.closest('button:disabled')) play('refused');
  });
}

onGameStart((ctx) => {
  const { game } = ctx;
  for (const event of Object.keys(ACTIVITY_SOUNDS) as (keyof ActivityEvents)[]) {
    game.activity.on(event, (payload) => {
      const key = soundFor(ACTIVITY_SOUNDS, event, payload);
      if (key) play(key);
    });
  }
  for (const event of Object.keys(GAME_EVENT_SOUNDS) as (keyof GameEvents)[]) {
    game.events.on(event, (payload) => {
      const key = soundFor(GAME_EVENT_SOUNDS, event, payload);
      if (key) play(key);
    });
  }
  for (const event of Object.keys(UI_SOUNDS) as (keyof UiSignals)[]) {
    uiSignals.on(event, (payload) => {
      const key = soundFor(UI_SOUNDS, event, payload);
      if (key) play(key);
    });
  }
  listenToButtons(document.getElementById('ui') ?? document.body);

  // The farm is on screen now: fetch the effects. Music streams only once audio has started.
  engine.fetch(Object.keys(SFX));
  for (const g of GESTURES) window.addEventListener(g, unlock, true);
  document.addEventListener('visibilitychange', () => engine.setHidden(document.visibilityState === 'hidden'));
  scheduleAnimal(ctx);
});

// Controls -------------------------------------------------------------------------

registerHudButton({
  id: 'sound',
  label: 'Mute',
  icon: '🔊',
  onClick: () => updateSettings({ muted: !settings.muted }),
  live: () => (settings.muted ? { icon: '🔇', label: 'Unmute' } : { icon: '🔊', label: 'Mute' }),
});

function slider(id: string, label: string, value: number, onInput: (v: number) => void): HTMLElement {
  const output = h('output', { class: 'slider-value', for: `vol-${id}` }, String(value));
  const input = h('input', {
    type: 'range',
    id: `vol-${id}`,
    min: 0,
    max: 100,
    step: 5,
    value,
    'data-testid': `vol-${id}`,
    oninput: () => {
      output.textContent = input.value;
      onInput(Number(input.value));
    },
  });
  return h('label', { class: 'slider-row', for: `vol-${id}` }, h('span', { class: 'slider-label' }, label), input, output);
}

registerSettingsSection({
  id: 'sound',
  render(ctx, body) {
    const mute = h('input', {
      type: 'checkbox',
      id: 'sound-mute',
      'data-testid': 'sound-mute',
      checked: settings.muted,
      onchange: () => updateSettings({ muted: mute.checked }),
    });
    body.append(
      h(
        'section',
        { class: 'sound-settings', 'data-testid': 'sound-settings' },
        h('h3', { class: 'group-title' }, 'Sound'),
        slider('music', 'Music', settings.musicVolume, (v) => updateSettings({ musicVolume: v })),
        slider('sfx', 'Effects', settings.sfxVolume, (v) => updateSettings({ sfxVolume: v })),
        h('label', { class: 'check-row', for: 'sound-mute' }, mute, 'Mute all sound'),
        h('button', { type: 'button', class: 'btn btn-secondary', 'data-testid': 'btn-credits', onclick: () => ctx.ui.toggleSheet(creditsSheet(ctx)) }, 'Credits'),
      ),
    );
  },
});

function creditsSheet(ctx: FarmContext): SheetSpec {
  return {
    id: 'credits',
    title: () => '🎵 Credits',
    signature: () => 'credits',
    render: (body) => {
      const attributed = AUDIO_CREDITS.filter((c) => c.license !== 'CC0');
      body.append(
        h('p', {}, 'Sound effects, ambience and music are free recordings shared under open licences. Thank you!'),
        attributed.length
          ? h(
              'ul',
              { class: 'credits-list', 'data-testid': 'credits-list' },
              attributed.map((c) =>
                h('li', {}, `“${c.title}” by ${c.author} (`, h('a', { href: c.url, target: '_blank', rel: 'noopener' }, c.license), ')'),
              ),
            )
          : '',
        h('p', { class: 'muted' }, 'All other sounds are CC0 (public domain). The full list is in CREDITS.md.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => ctx.ui.closePanel() }, 'Close')),
      );
    },
  };
}
