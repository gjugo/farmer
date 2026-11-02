import { describe, expect, it } from 'vitest';
import { FIELD } from '../../data/crops';
import { edgeNames, FRINGE_ART, fringeArt, NE, NW, SE, SW } from '../../scenes/art';
import { fringeTiles, type FringeObject } from './layout';

const MAP = 20;
const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP && y < MAP;
const path = (x: number, y: number): FringeObject => ({ type: 'path', x, y, w: 1, h: 1 });
const field = (x: number, y: number): FringeObject => ({ type: FIELD, x, y, w: 2, h: 2 });

/** The fringed edges of tile (x, y) by name, as `window.farm.fringes.at` reports them. */
function edgesAt(objects: FringeObject[], x: number, y: number): string[] {
  return edgeNames(fringeTiles(objects, inMap).find((t) => t.x === x && t.y === y)?.edges ?? 0);
}

describe('grass fringes', () => {
  it('fringes a lone path on all four sides', () => {
    expect(fringeTiles([path(5, 5)], inMap)).toEqual([{ x: 5, y: 5, kind: 'path', edges: NE | SE | SW | NW }]);
  });

  it('puts no fringe between neighbouring paths, on both of them', () => {
    const objects = [path(5, 5), path(6, 5)];
    expect(edgesAt(objects, 5, 5)).toEqual(['ne', 'sw', 'nw']);
    expect(edgesAt(objects, 6, 5)).toEqual(['ne', 'se', 'sw']);
  });

  it('leaves a path through the middle of a line with its two sides only', () => {
    const objects = [path(5, 4), path(5, 5), path(5, 6)];
    expect(edgesAt(objects, 5, 5)).toEqual(['se', 'nw']);
    expect(edgesAt(objects, 5, 4)).toEqual(['ne', 'se', 'nw']);
  });

  it('gives a crossroads none at all', () => {
    const objects = [path(5, 5), path(5, 4), path(6, 5), path(5, 6), path(4, 5)];
    expect(edgesAt(objects, 5, 5)).toEqual([]);
    expect(fringeTiles(objects, inMap).some((t) => t.x === 5 && t.y === 5)).toBe(false);
  });

  it('puts none where a path meets a building, a pen or a field', () => {
    const objects = [path(5, 5), { type: 'cottage', x: 6, y: 4, w: 2, h: 2 }, { type: 'pasture', x: 1, y: 4, w: 4, h: 4 }, field(5, 6)];
    expect(edgesAt(objects, 5, 5)).toEqual(['ne']);
  });

  it('runs a field’s fringe round its outer edge only', () => {
    const objects = [field(4, 4)];
    expect(edgesAt(objects, 4, 4)).toEqual(['ne', 'nw']);
    expect(edgesAt(objects, 5, 4)).toEqual(['ne', 'se']);
    expect(edgesAt(objects, 5, 5)).toEqual(['se', 'sw']);
    expect(edgesAt(objects, 4, 5)).toEqual(['sw', 'nw']);
    expect(fringeTiles(objects, inMap).every((t) => t.kind === 'field')).toBe(true);
  });

  it('puts none between two fields, or a field and a path', () => {
    const objects = [field(4, 4), field(6, 4), path(5, 6)];
    expect(edgesAt(objects, 5, 4)).toEqual(['ne']);
    expect(edgesAt(objects, 6, 4)).toEqual(['ne']);
    expect(edgesAt(objects, 5, 5)).toEqual([]);
    expect(edgesAt(objects, 5, 6)).toEqual(['se', 'sw', 'nw']);
  });

  it('fringes nothing else: buildings, pens and pastures stay as they are', () => {
    const objects = [{ type: 'cottage', x: 2, y: 2, w: 2, h: 2 }, { type: 'pasture', x: 8, y: 8, w: 4, h: 4 }];
    expect(fringeTiles(objects, inMap)).toEqual([]);
  });

  it('puts none along the map’s edge', () => {
    expect(edgesAt([path(0, 0)], 0, 0)).toEqual(['se', 'sw']);
  });

  it('drops the fringes of a demolished path and gives its neighbour that side back', () => {
    const both = [path(5, 5), path(6, 5)];
    expect(edgesAt(both, 5, 5)).not.toContain('se');
    const after = fringeTiles([path(5, 5)], inMap);
    expect(after).toEqual([{ x: 5, y: 5, kind: 'path', edges: NE | SE | SW | NW }]);
  });

  it('lists the tiles back to front, the order to draw them', () => {
    const tiles = fringeTiles([path(7, 7), path(1, 1), field(3, 2)], inMap);
    const depth = tiles.map((t) => t.x + t.y);
    expect(depth).toEqual([...depth].sort((a, b) => a - b));
  });

  it('names a strip per kind and edge', () => {
    expect(fringeArt('path', NE)).toBe('fringe_path_ne');
    expect(fringeArt('field', SW)).toBe('fringe_field_sw');
    expect(fringeArt('road', SE)).toBe('fringe_road_se');
    expect(FRINGE_ART).toHaveLength(12);
    expect(new Set(FRINGE_ART).size).toBe(12);
  });
});
