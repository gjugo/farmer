/** Minimum real milliseconds between two plays of the same sound. */
export const SAME_SOUND_GAP_MS = 150;

/**
 * Stops sound spam (e.g. dozens of harvests a second at ×60): the same key plays at
 * most once per `gapMs`, and at most `maxVoices` sounds overlap at a time.
 */
export class SoundThrottle {
  private readonly last = new Map<string, number>();
  private readonly ends: number[] = [];

  constructor(
    private readonly gapMs = SAME_SOUND_GAP_MS,
    private readonly maxVoices = 6,
  ) {}

  /** Should `key` play at `now`? When it should, the play is recorded; it lasts `durationMs`. */
  allow(key: string, now: number, durationMs = 0): boolean {
    const last = this.last.get(key);
    if (last !== undefined && now - last < this.gapMs) return false;
    while (this.ends.length && this.ends[0] <= now) this.ends.shift();
    if (this.ends.length >= this.maxVoices) return false;
    this.last.set(key, now);
    this.ends.push(now + Math.max(0, durationMs));
    this.ends.sort((a, b) => a - b);
    return true;
  }
}
