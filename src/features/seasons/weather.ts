import Phaser from 'phaser';
import type { Season } from '../../data/seasons';
import { registerTexture } from '../../scenes/textures';

/**
 * Weather: snowfall in winter, drifting leaves in autumn, a few petals in spring, clear summers. A scene of its
 * own drawn over the farm in screen space, so it only ever covers the view, whatever the farm camera's zoom.
 * One particle emitter; how many particles it keeps alive is set from outside (see `weatherBudget`).
 */

export const WEATHER_SCENE = 'Weather';

registerTexture('wx-flake', {
  width: 12,
  height: 12,
  draw: (g) => {
    g.fillStyle(0xffffff, 0.35).fillCircle(6, 6, 6);
    g.fillStyle(0xffffff, 1).fillCircle(6, 6, 3.6);
  },
});

/** Drawn white, tinted per particle. */
registerTexture('wx-leaf', {
  width: 14,
  height: 9,
  draw: (g) => {
    g.fillStyle(0xffffff).fillEllipse(7, 4.5, 14, 8);
    g.lineStyle(1, 0xb0b0b0).lineBetween(1, 4.5, 13, 4.5);
  },
});

registerTexture('wx-petal', {
  width: 8,
  height: 6,
  draw: (g) => {
    g.fillStyle(0xffffff).fillEllipse(4, 3, 8, 5);
  },
});

interface Kind {
  texture: string;
  lifespan: [number, number];
  speedX: [number, number];
  speedY: [number, number];
  scale: [number, number];
  tint?: number[];
  spin?: boolean;
}

const KINDS: Partial<Record<Season, Kind>> = {
  winter: { texture: 'wx-flake', lifespan: [4000, 7000], speedX: [-14, 14], speedY: [35, 75], scale: [0.35, 1] },
  autumn: {
    texture: 'wx-leaf',
    lifespan: [5000, 8000],
    speedX: [15, 50],
    speedY: [28, 55],
    scale: [0.6, 1],
    tint: [0xe0782a, 0xc8452e, 0xe8b830, 0xa5552a],
    spin: true,
  },
  spring: {
    texture: 'wx-petal',
    lifespan: [5000, 8000],
    speedX: [10, 32],
    speedY: [14, 30],
    scale: [0.7, 1.1],
    tint: [0xffc2d8, 0xffffff, 0xff9ec4],
    spin: true,
  },
};

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

export class WeatherScene extends Phaser.Scene {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private season: Season | null = null;
  private budget = 0;

  constructor() {
    super(WEATHER_SCENE);
  }

  /** Live particles. */
  get count(): number {
    return this.emitter?.getAliveParticleCount() ?? 0;
  }

  /** Shows `season`'s weather with up to `budget` particles alive (0 clears the sky). */
  setWeather(season: Season, budget: number): void {
    if (!this.sys.isActive()) return;
    const kind = KINDS[season];
    if (season !== this.season) {
      this.emitter?.destroy();
      this.emitter = kind ? this.makeEmitter(kind) : null;
      this.season = season;
      this.budget = -1;
    }
    if (!this.emitter || !kind || budget === this.budget) return;
    this.budget = budget;
    if (budget <= 0) {
      this.emitter.stop();
      this.emitter.killAll();
      return;
    }
    // A steady state of `budget` particles: one every average lifespan / budget ms.
    this.emitter.frequency = (kind.lifespan[0] + kind.lifespan[1]) / 2 / budget;
    this.emitter.maxAliveParticles = budget;
    if (!this.emitter.emitting) this.emitter.start();
  }

  private makeEmitter(kind: Kind): Phaser.GameObjects.Particles.ParticleEmitter {
    // Particles start anywhere on screen and fade in and out, so the view is never empty after a change.
    return this.add.particles(0, 0, kind.texture, {
      x: { onEmit: () => Math.random() * this.scale.width },
      y: { onEmit: () => Math.random() * (this.scale.height + 40) - 40 },
      lifespan: { onEmit: () => between(kind.lifespan) },
      speedX: { onEmit: () => between(kind.speedX) },
      speedY: { onEmit: () => between(kind.speedY) },
      scale: { onEmit: () => between(kind.scale) },
      alpha: { onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => Math.min(1, Math.sin(Math.PI * t) * 1.6) },
      ...(kind.tint ? { tint: { onEmit: () => kind.tint![Math.floor(Math.random() * kind.tint!.length)] } } : {}),
      ...(kind.spin ? { rotate: { onEmit: () => Math.random() * 360, onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, _t: number, value: number) => value + 1.5 } } : {}),
      frequency: 1000,
      maxAliveParticles: 1,
      emitting: false,
    });
  }
}
