import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_CREDITS } from './credits';
import { ACTIVITY_SOUNDS, AMBIENCE, ANIMAL_GAP_MS, GAME_EVENT_SOUNDS, MUSIC, nextAnimalDelay, pickAnimalSound, SFX, soundFor, UI_SOUNDS } from './sounds';
import { AUDIO_SETTINGS_KEY, DEFAULT_AUDIO_SETTINGS, loadAudioSettings, saveAudioSettings, sliderGain } from './settings';
import { SAME_SOUND_GAP_MS, SoundThrottle } from './throttle';

describe('sound mapping', () => {
  it('maps every player action to its sound', () => {
    expect(soundFor(ACTIVITY_SOUNDS, 'placed', { type: 'coop' })).toBe('build');
    expect(soundFor(ACTIVITY_SOUNDS, 'planted', { crop: 'wheat' })).toBe('plant');
    expect(soundFor(ACTIVITY_SOUNDS, 'harvested', { item: 'wheat', qty: 3 })).toBe('harvest');
    expect(soundFor(ACTIVITY_SOUNDS, 'animalBought', { kind: 'cow' })).toBe('buy_animal');
    expect(soundFor(ACTIVITY_SOUNDS, 'fed', { count: 2, grazing: false })).toBe('feed');
    expect(soundFor(ACTIVITY_SOUNDS, 'jobStarted', { recipe: 'cheese' })).toBe('process_start');
    expect(soundFor(ACTIVITY_SOUNDS, 'jobsFinished', { count: 1 })).toBe('process_done');
    expect(soundFor(ACTIVITY_SOUNDS, 'sold', { item: 'egg', qty: 1, earned: 10 })).toBe('coins');
    expect(soundFor(ACTIVITY_SOUNDS, 'orderFulfilled', { reward: 70 })).toBe('order');
    expect(soundFor(ACTIVITY_SOUNDS, 'goalClaimed', { id: 'g1' })).toBe('goal');
    expect(soundFor(GAME_EVENT_SOUNDS, 'levelUp', { level: 2, bonus: 100, unlocks: [] })).toBe('levelup');
    expect(soundFor(UI_SOUNDS, 'refused', { message: 'Not enough money' })).toBe('refused');
    expect(soundFor(UI_SOUNDS, 'welcomeBack', { awayMs: 60_000 })).toBe('welcome');
  });

  it('gives each animal product its own collect sound', () => {
    expect(soundFor(ACTIVITY_SOUNDS, 'collected', { item: 'egg', qty: 1 })).toBe('collect_egg');
    expect(soundFor(ACTIVITY_SOUNDS, 'collected', { item: 'milk', qty: 1 })).toBe('collect_milk');
    expect(soundFor(ACTIVITY_SOUNDS, 'collected', { item: 'wool', qty: 1 })).toBe('collect_wool');
  });

  it('plays nothing for routine state changes, so offline catch-up stays quiet', () => {
    expect(soundFor(GAME_EVENT_SOUNDS, 'objectChanged', { id: 'o1', type: 'field', x: 0, y: 0, state: {} })).toBeNull();
    expect(soundFor(GAME_EVENT_SOUNDS, 'day', 3)).toBeNull();
    expect(soundFor(GAME_EVENT_SOUNDS, 'money', { money: 10, delta: 5 })).toBeNull();
    expect(soundFor(ACTIVITY_SOUNDS, 'income', { amount: 5 })).toBeNull();
  });

  it('only names sounds that exist in the catalogue', () => {
    const maps = [ACTIVITY_SOUNDS, GAME_EVENT_SOUNDS, UI_SOUNDS] as Record<string, (p: never) => string | null>[];
    for (const map of maps) {
      for (const fn of Object.values(map)) {
        const key = fn({ item: 'egg' } as never);
        if (key) expect(SFX).toHaveProperty(key);
      }
    }
  });
});

describe('animal sounds', () => {
  it('waits 8–15 s between animal sounds', () => {
    expect(nextAnimalDelay(0)).toBe(ANIMAL_GAP_MS.min);
    expect(nextAnimalDelay(0.999)).toBeLessThan(ANIMAL_GAP_MS.max);
    expect(ANIMAL_GAP_MS).toEqual({ min: 8_000, max: 15_000 });
  });

  it('only picks animals that live on the farm', () => {
    expect(pickAnimalSound([], 0.5)).toBeNull();
    expect(pickAnimalSound(['chicken', 'chicken', 'chicken'], 0)).toBe('cluck');
    expect(pickAnimalSound(['chicken', 'chicken', 'chicken'], 0.99)).toBe('cluck2');
    expect(pickAnimalSound(['cow'], 0)).toBe('moo');
    const both = ['chicken', 'sheep'];
    expect(pickAnimalSound(both, 0)).toBe('cluck');
    expect(pickAnimalSound(both, 0.99)).toBe('baa2');
    for (let r = 0; r < 1; r += 0.01) expect(['cluck', 'cluck2', 'baa', 'baa2']).toContain(pickAnimalSound(both, r));
    expect(pickAnimalSound(['dragon'], 0.5)).toBeNull();
  });
});

describe('SoundThrottle', () => {
  it('plays the same sound at most once per gap', () => {
    const t = new SoundThrottle();
    expect(t.allow('coins', 1000)).toBe(true);
    expect(t.allow('coins', 1000 + SAME_SOUND_GAP_MS - 1)).toBe(false);
    expect(t.allow('coins', 1000 + SAME_SOUND_GAP_MS)).toBe(true);
  });

  it('lets different sounds play together', () => {
    const t = new SoundThrottle();
    expect(t.allow('coins', 0)).toBe(true);
    expect(t.allow('harvest', 0)).toBe(true);
  });

  it('a refused play does not restart the gap', () => {
    const t = new SoundThrottle(150);
    expect(t.allow('a', 0)).toBe(true);
    expect(t.allow('a', 100)).toBe(false);
    expect(t.allow('a', 150)).toBe(true);
  });

  it('caps the number of overlapping sounds', () => {
    const t = new SoundThrottle(150, 2);
    expect(t.allow('a', 0, 1000)).toBe(true);
    expect(t.allow('b', 0, 1000)).toBe(true);
    expect(t.allow('c', 0, 1000)).toBe(false);
    expect(t.allow('c', 1000, 1000)).toBe(true);
  });

  it('keeps sound spam at ×60 to a handful of plays', () => {
    const t = new SoundThrottle();
    let played = 0;
    // 100 harvests in one second (one per 10 ms).
    for (let ms = 0; ms < 1000; ms += 10) if (t.allow('harvest', ms, 300)) played++;
    expect(played).toBeLessThanOrEqual(Math.ceil(1000 / SAME_SOUND_GAP_MS));
  });
});

describe('audio settings', () => {
  const memory = (init: Record<string, string> = {}) => {
    const data = new Map(Object.entries(init));
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('defaults to effects on and quiet music', () => {
    expect(loadAudioSettings(memory())).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(DEFAULT_AUDIO_SETTINGS.muted).toBe(false);
    expect(DEFAULT_AUDIO_SETTINGS.musicVolume).toBeLessThan(DEFAULT_AUDIO_SETTINGS.sfxVolume);
    expect(loadAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('round-trips through storage', () => {
    const s = memory();
    saveAudioSettings(s, { muted: true, musicVolume: 10, sfxVolume: 55 });
    expect(loadAudioSettings(s)).toEqual({ muted: true, musicVolume: 10, sfxVolume: 55 });
  });

  it('repairs broken or out-of-range values', () => {
    expect(loadAudioSettings(memory({ [AUDIO_SETTINGS_KEY]: 'not json' }))).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadAudioSettings(memory({ [AUDIO_SETTINGS_KEY]: '{"muted":"yes","musicVolume":250,"sfxVolume":-3}' }))).toEqual({
      muted: DEFAULT_AUDIO_SETTINGS.muted,
      musicVolume: 100,
      sfxVolume: 0,
    });
  });

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => saveAudioSettings(broken, DEFAULT_AUDIO_SETTINGS)).not.toThrow();
    expect(loadAudioSettings(broken)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('maps sliders to a perceptual gain', () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(100)).toBe(1);
    expect(sliderGain(50)).toBeCloseTo(0.25);
  });
});

describe('audio files', () => {
  const dir = path.resolve(__dirname, '../../../public/audio');
  const keys = [...Object.keys(SFX), AMBIENCE, ...MUSIC];

  it('every sound has an MP3 and a credit, and nothing else ships', () => {
    const files = readdirSync(dir).sort();
    expect(files).toEqual(keys.map((k) => `${k}.mp3`).sort());
    expect(AUDIO_CREDITS.map((c) => c.key).sort()).toEqual([...keys].sort());
  });

  it('uses only CC0, public domain or CC-BY licences', () => {
    for (const c of AUDIO_CREDITS) expect(c.license).toMatch(/^(CC0|Public Domain|CC-BY [34]\.0)$/);
  });

  it('stays within 3 MB in total', () => {
    const total = readdirSync(dir).reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);
    expect(total).toBeLessThanOrEqual(3 * 1024 * 1024);
  });
});
