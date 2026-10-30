import { sliderGain, type AudioSettings } from './settings';

/** Seconds of crossfade between music tracks. */
const MUSIC_FADE_S = 3;
/** Ambience level relative to the effects volume. */
const AMBIENCE_LEVEL = 0.35;
/** Music level at a full slider; the tracks sit under the effects. */
const MUSIC_LEVEL = 0.6;
/** Smoothing time constant for volume changes, so they never click. */
const RAMP_S = 0.05;

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * A small Web Audio engine. Nothing touches the AudioContext before the first user
 * gesture (`unlock`), so browsers log no autoplay warnings. Effects and the ambience are
 * decoded buffers (gapless looping); music streams through <audio> elements routed into
 * the graph, so its volume works on iOS too.
 *
 *   effects ─► sfxBus ──────┐
 *   ambience ► ambienceBus ─┼─► master (mute) ─► speakers
 *   music ───► musicBus ────┘
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambienceBus!: GainNode;
  private musicBus!: GainNode;
  private readonly files = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly decoding = new Map<string, Promise<void>>();
  private ambienceKey: string | null = null;
  private ambienceStarted = false;
  private music: MusicPlayer | null = null;
  private settings: AudioSettings;
  private hidden = false;

  constructor(
    settings: AudioSettings,
    private readonly url: (key: string) => string,
  ) {
    this.settings = { ...settings };
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** Starts downloading files (no decoding yet: that needs the AudioContext). */
  fetch(keys: readonly string[]): void {
    for (const key of keys) {
      if (this.files.has(key)) continue;
      this.files.set(
        key,
        fetch(this.url(key))
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null),
      );
    }
    if (this.ctx) this.decodeAll();
  }

  /** Creates the AudioContext. Call from a user gesture handler; later calls just resume it. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.hidden) void this.ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = this.bus();
    this.ambienceBus = this.bus();
    this.musicBus = this.bus();
    this.applySettings(true);
    void ctx.resume().catch(() => {});
    this.decodeAll();
  }

  private bus(): GainNode {
    const g = this.ctx!.createGain();
    g.connect(this.master);
    return g;
  }

  private decodeAll(): void {
    for (const [key, file] of this.files) {
      if (this.decoding.has(key)) continue;
      const decoded = file.then(async (data) => {
        // decodeAudioData detaches the bytes, so each file is decoded once.
        if (!data || !this.ctx || data.byteLength === 0) return;
        try {
          this.buffers.set(key, await this.ctx.decodeAudioData(data));
          if (key === this.ambienceKey) this.startAmbience();
        } catch {
          // Undecodable file: that sound stays silent.
        }
      });
      this.decoding.set(key, decoded);
    }
  }

  /** Resolves once `key` has been decoded (or failed to). Needs `unlock` first. */
  async ready(key: string): Promise<void> {
    await this.decoding.get(key);
  }

  /** Length of a decoded effect in ms (0 when not loaded). */
  durationOf(key: string): number {
    return (this.buffers.get(key)?.duration ?? 0) * 1000;
  }

  /** Plays a decoded effect once. Returns false when it could not play (locked or not loaded yet). */
  play(key: string, volume = 1): boolean {
    const ctx = this.ctx;
    const buffer = this.buffers.get(key);
    if (!ctx || !buffer) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Slight pitch variety keeps repeated sounds from feeling mechanical.
    source.playbackRate.value = 0.96 + Math.random() * 0.08;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.sfxBus);
    source.onended = () => gain.disconnect();
    source.start();
    return true;
  }

  /** Loops `key` as the ambience once it is decoded. */
  setAmbience(key: string): void {
    this.ambienceKey = key;
    this.fetch([key]);
    this.startAmbience();
  }

  private startAmbience(): void {
    const ctx = this.ctx;
    const buffer = this.ambienceKey ? this.buffers.get(this.ambienceKey) : undefined;
    if (!ctx || !buffer || this.ambienceStarted) return;
    this.ambienceStarted = true;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // Skip the few milliseconds of MP3 encoder padding at both ends so the loop has no gap.
    const pad = Math.min(0.03, buffer.duration / 10);
    source.loopStart = pad;
    source.loopEnd = buffer.duration - pad;
    const fadeIn = ctx.createGain();
    fadeIn.gain.setValueAtTime(0, ctx.currentTime);
    fadeIn.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
    source.connect(fadeIn).connect(this.ambienceBus);
    source.start(0, pad);
  }

  /** Starts the playlist (streamed: nothing is downloaded before this). Needs `unlock` first. */
  startMusic(keys: readonly string[]): void {
    if (!this.ctx || this.music || keys.length === 0) return;
    this.music = new MusicPlayer(this.ctx, this.musicBus, keys.map(this.url));
    if (!this.hidden) this.music.play();
  }

  setSettings(settings: AudioSettings): void {
    this.settings = { ...settings };
    this.applySettings(false);
  }

  private applySettings(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { muted, musicVolume, sfxVolume } = this.settings;
    const set = (node: GainNode, value: number) => {
      if (immediate) node.gain.value = value;
      else node.gain.setTargetAtTime(value, ctx.currentTime, RAMP_S);
    };
    set(this.master, muted ? 0 : 1);
    set(this.sfxBus, sliderGain(sfxVolume));
    set(this.ambienceBus, sliderGain(sfxVolume) * AMBIENCE_LEVEL);
    set(this.musicBus, sliderGain(musicVolume) * MUSIC_LEVEL);
  }

  /** Pauses everything while the tab is hidden and resumes when it is visible again. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!this.ctx) return;
    if (hidden) {
      this.music?.pause();
      void this.ctx.suspend().catch(() => {});
    } else {
      void this.ctx.resume().catch(() => {});
      this.music?.play();
    }
  }
}

/** Plays tracks one after another, crossfading between them. */
class MusicPlayer {
  private readonly tracks: { el: HTMLAudioElement; gain: GainNode }[] = [];
  private current = 0;
  private fading = false;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    urls: readonly string[],
  ) {
    for (const url of urls) {
      const el = new Audio();
      el.preload = 'none';
      el.src = url;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(out);
      el.addEventListener('timeupdate', () => this.onTime(el));
      // A track that ends without a crossfade (very short file) still moves on.
      el.addEventListener('ended', () => {
        if (el === this.tracks[this.current].el) this.next();
      });
      this.tracks.push({ el, gain });
    }
  }

  play(): void {
    const t = this.tracks[this.current];
    if (t.gain.gain.value === 0 && t.el.currentTime === 0) this.fadeIn(t);
    void t.el.play().catch(() => {});
  }

  pause(): void {
    for (const t of this.tracks) t.el.pause();
  }

  private fadeIn(t: { gain: GainNode }): void {
    const now = this.ctx.currentTime;
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.setValueAtTime(0, now);
    t.gain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE_S);
  }

  private onTime(el: HTMLAudioElement): void {
    if (this.fading || el !== this.tracks[this.current].el) return;
    if (Number.isFinite(el.duration) && el.duration - el.currentTime <= MUSIC_FADE_S) this.next();
  }

  /** Fades the current track out and the next one in. */
  private next(): void {
    if (this.fading) return;
    this.fading = true;
    const out = this.tracks[this.current];
    this.current = (this.current + 1) % this.tracks.length;
    const into = this.tracks[this.current];
    const now = this.ctx.currentTime;
    out.gain.gain.cancelScheduledValues(now);
    out.gain.gain.setValueAtTime(out.gain.gain.value, now);
    out.gain.gain.linearRampToValueAtTime(0, now + MUSIC_FADE_S);
    if (into !== out) into.el.currentTime = 0;
    this.fadeIn(into);
    void into.el.play().catch(() => {});
    window.setTimeout(() => {
      if (into !== out) {
        out.el.pause();
        out.el.currentTime = 0;
      }
      this.fading = false;
    }, MUSIC_FADE_S * 1000);
  }
}
