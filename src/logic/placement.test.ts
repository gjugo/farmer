import { describe, expect, it } from 'vitest';
import { START_LAND } from './constants';
import { footprintOf, Game } from './game';
import { canPlace } from './placement';
import { createNewGame } from './state';
import type { GameState } from './types';

const inside = { x: START_LAND.x + 1, y: START_LAND.y + 1 };

/** A new game with nothing built (no starting fields, farmhouse or road). */
function emptyFarm(): GameState {
  const s = createNewGame();
  s.objects = [];
  s.nextObjectId = 1;
  return s;
}

describe('placement', () => {
  it('allows a free, owned tile', () => {
    const s = emptyFarm();
    expect(canPlace(s, { w: 1, h: 1 }, inside.x, inside.y, footprintOf)).toEqual({ ok: true });
  });

  it('refuses locked land', () => {
    const s = emptyFarm();
    expect(canPlace(s, { w: 1, h: 1 }, 0, 0, footprintOf)).toEqual({ ok: false, reason: 'locked' });
  });

  it('refuses a footprint that pokes past the owned edge', () => {
    const s = emptyFarm();
    const lastX = START_LAND.x + START_LAND.w - 1;
    expect(canPlace(s, { w: 1, h: 1 }, lastX, inside.y, footprintOf).ok).toBe(true);
    expect(canPlace(s, { w: 2, h: 1 }, lastX, inside.y, footprintOf)).toEqual({ ok: false, reason: 'locked' });
  });

  it('refuses out-of-bounds tiles', () => {
    const s = emptyFarm();
    expect(canPlace(s, { w: 1, h: 1 }, -1, 3, footprintOf)).toEqual({ ok: false, reason: 'out-of-bounds' });
    expect(canPlace(s, { w: 1, h: 1 }, 99, 3, footprintOf)).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('refuses tiles covered by another object, including multi-tile footprints', () => {
    const s = emptyFarm();
    s.objects.push({ id: 'o1', type: 'path', x: inside.x, y: inside.y, state: {} });
    expect(canPlace(s, { w: 1, h: 1 }, inside.x, inside.y, footprintOf)).toEqual({ ok: false, reason: 'occupied' });
    expect(canPlace(s, { w: 2, h: 2 }, inside.x - 1, inside.y - 1, footprintOf)).toEqual({ ok: false, reason: 'occupied' });
    expect(canPlace(s, { w: 2, h: 2 }, inside.x + 1, inside.y, footprintOf).ok).toBe(true);
  });
});

describe('Game.place / demolish', () => {
  it('placing a path costs $5 and demolishing refunds $2', () => {
    const g = new Game(emptyFarm());
    const r = g.place('path', inside.x, inside.y);
    expect(r.ok).toBe(true);
    expect(g.money).toBe(495);
    expect(g.objectAt(inside.x, inside.y)?.type).toBe('path');
    if (!r.ok) return;
    expect(g.demolish(r.object.id)).toBe(2);
    expect(g.money).toBe(497);
    expect(g.state.objects).toHaveLength(0);
  });

  it('refuses locked land, occupied tiles and unknown types without charging', () => {
    const g = new Game(emptyFarm());
    expect(g.place('path', 0, 0)).toEqual({ ok: false, reason: 'locked' });
    g.place('path', inside.x, inside.y);
    expect(g.place('path', inside.x, inside.y)).toEqual({ ok: false, reason: 'occupied' });
    expect(g.place('spaceship', inside.x + 1, inside.y)).toEqual({ ok: false, reason: 'unknown-type' });
    expect(g.money).toBe(495);
  });

  it('refuses when the player cannot afford it', () => {
    const g = new Game(emptyFarm());
    g.spend(497);
    expect(g.place('path', inside.x, inside.y)).toEqual({ ok: false, reason: 'money' });
    expect(g.money).toBe(3);
    expect(g.state.objects).toHaveLength(0);
  });

  it('gives each object a unique id and emits events', () => {
    const g = new Game(emptyFarm());
    const seen: string[] = [];
    g.events.on('objectAdded', (o) => seen.push(`+${o.id}`));
    g.events.on('objectRemoved', (o) => seen.push(`-${o.id}`));
    g.events.on('money', (m) => seen.push(`$${m.delta}`));
    g.place('path', inside.x, inside.y);
    g.place('path', inside.x + 1, inside.y);
    g.demolish('o1');
    expect(seen).toEqual(['$-5', '+o1', '$-5', '+o2', '-o1', '$2']);
  });

  it('emits a day event when the day rolls over', () => {
    const g = new Game(emptyFarm());
    const days: number[] = [];
    g.events.on('day', (d) => days.push(d));
    g.setSpeed(2000);
    g.tick(240);
    expect(days).toEqual([2]);
    expect(g.day).toBe(2);
  });

  it('snapshot is a frozen copy', () => {
    const g = new Game(emptyFarm());
    const snap = g.snapshot();
    expect(snap.day).toBe(1);
    expect(Object.isFrozen(snap.inventory)).toBe(true);
    g.earn(10);
    expect(snap.money).toBe(500);
  });
});
