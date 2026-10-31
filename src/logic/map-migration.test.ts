import { describe, expect, it } from 'vitest';
import { getBuildable } from '../data/buildables';
import { FARMHOUSE, PATH } from '../data/farmhouse';
import { MAP_HEIGHT, MAP_WIDTH, START_LAND } from './constants';
import { Game } from './game';
import { isOwned } from './land';
import { FARM_PARCELS, isParcelOwned, parcelAt, parcelsBought } from './parcels';
import { findRoute } from './roads';
import { parseSave, serialize } from './save';
import { SAVE_V6 } from './save-v6.fixture';
import { activeJobs, jobPhase, workersOf } from './workers';
import type { GameState, PlacedObject } from './types';

const load = (): GameState => parseSave(JSON.stringify(SAVE_V6)).state;
const footprint = (o: PlacedObject) => ({ x: o.x, y: o.y, ...(getBuildable(o.type)?.footprint ?? { w: 1, h: 1 }) });

describe('version 6 saves on the bigger map', () => {
  it('move every object by the offset between the old and new starting land', () => {
    const state = load();
    // Old start (11, 8) → new start (24, 18).
    expect([START_LAND.x - 11, START_LAND.y - 8]).toEqual([13, 10]);
    expect(state.land).toMatchObject({ width: MAP_WIDTH, height: MAP_HEIGHT });
    const old = SAVE_V6.state.objects;
    expect(state.objects.map((o) => [o.id, o.type, o.x, o.y])).toEqual(old.map((o) => [o.id, o.type, o.x + 13, o.y + 10]));
    // Nothing else about them changes; no farmhouse or road is added.
    expect(state.objects.map((o) => o.state)).toEqual(old.map((o) => o.state));
    expect(state.nextObjectId).toBe(SAVE_V6.state.nextObjectId);
  });

  it('keeps the farm joined up by its paths', () => {
    const state = load();
    for (const o of state.objects) {
      if (o.type === PATH || o.type === FARMHOUSE) continue;
      expect(findRoute(state, footprint(o)), o.id).not.toBeNull();
    }
  });

  it('owns the whole new starting land, the shifted old land, and whole parcels only', () => {
    const state = load();
    const { land } = state;
    for (let y = START_LAND.y; y < START_LAND.y + START_LAND.h; y++) {
      for (let x = START_LAND.x; x < START_LAND.x + START_LAND.w; x++) expect(isOwned(land, x, y)).toBe(true);
    }
    SAVE_V6.state.land.owned.forEach((t, i) => {
      if (t === 1) expect(isOwned(land, (i % 32) + 13, Math.floor(i / 32) + 10)).toBe(true);
    });
    for (const p of FARM_PARCELS) {
      let owned = 0;
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) owned += isOwned(land, x, y) ? 1 : 0;
      expect([0, p.w * p.h], p.id).toContain(owned);
    }
    // The old parcel right of the start now lies inside the new starting land. The one below reaches past it into
    // the parcel below, which becomes the farm's, whole: one parcel bought, nothing left half-owned.
    const below = parcelAt(FARM_PARCELS, START_LAND.x, START_LAND.y + START_LAND.h)!;
    expect(isParcelOwned(land, below)).toBe(true);
    expect(isParcelOwned(land, parcelAt(FARM_PARCELS, START_LAND.x + START_LAND.w, START_LAND.y)!)).toBe(false);
    expect(parcelsBought(land, FARM_PARCELS, START_LAND)).toBe(1);
  });

  it('leaves no object on locked land', () => {
    const state = load();
    for (const o of state.objects) {
      const fp = footprint(o);
      for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) expect(isOwned(state.land, x, y), o.id).toBe(true);
    }
  });

  it('moves the farmer on the way to work, route and all, and the job goes on', () => {
    const state = load();
    const [job] = workersOf(state).jobs;
    expect(job).toMatchObject({ kind: 'plough', x: 23.5 + 13, y: 12.5 + 10, target: 'o11' });
    expect(job.route).toEqual(SAVE_V6.state.ext.workers.jobs[0].route.map((t) => ({ x: t.x + 13, y: t.y + 10 })));
    // The route still runs along the moved paths.
    const paths = new Set(state.objects.filter((o) => o.type === PATH).map((o) => `${o.x},${o.y}`));
    for (const t of job.route!) expect(paths.has(`${t.x},${t.y}`)).toBe(true);
    const game = new Game(state);
    expect(jobPhase(game.state.clock, job).phase).toBe('work');
    game.advance(60_000);
    // The ploughing finished on the moved field, and its farmer keeps working it.
    const field = game.state.objects.find((o) => o.id === 'o11')!;
    expect((field.state as { ploughedAt: number | null }).ploughedAt).not.toBeNull();
    expect(activeJobs(game.state.clock, workersOf(game.state)).every((j) => j.route!.every((t) => paths.has(`${t.x},${t.y}`)))).toBe(true);
  });

  it('loads the same farm again after saving', () => {
    const state = load();
    expect(parseSave(serialize(state)).state).toEqual(state);
  });
});
