import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COTTAGE } from '../data/families';
import { FIELD } from '../data/crops';
import { GUIDE_STEPS, type GuideStepId } from '../data/guide';
import { START_LAYOUT } from './constants';
import { plant, type FieldState } from './crops';
import { Game } from './game';
import { currentStep, endGuide, guideInfo, guideOf, GUIDE, nextStep, notifyGuide, skipGuide, startGuide, type GuideSignal } from './guide';
import { parseSave, serialize } from './save';
import { addStartingObject } from './state';
import type { PlacedObject } from './types';
import { STARTING_FIELDS } from './crops';
import { useClassicStart } from './test-utils';
import { assignFarmer } from './workers';

/** A free spot near the farm, clear of the camp and the fields. */
const SPOT = { x: START_LAYOUT.x, y: START_LAYOUT.y + 6 };

// The guide walks a new farm: only the camp, no fields.
beforeAll(() => useClassicStart(false));
afterAll(() => useClassicStart(true));

/** Adds `n` finished, ploughed fields (no event) left of the camp. */
function addFields(game: Game, n: number): void {
  for (const { x, y } of STARTING_FIELDS.slice(0, n)) {
    const field = addStartingObject(game.state, FIELD, x, y);
    if (!field) throw new Error('could not add a field');
    (field.state as FieldState).ploughedAt = game.now;
  }
}

function started(): Game {
  const game = new Game();
  startGuide(game);
  return game;
}

const stepId = (game: Game) => currentStep(game)?.id ?? null;
const index = (id: GuideStepId) => GUIDE_STEPS.findIndex((s) => s.id === id);
const fields = (game: Game) => game.objectsOfType(FIELD) as PlacedObject<FieldState>[];
const placed = (type: string): GuideSignal => ({ kind: 'activity', name: 'placed', payload: { type } });

/** Puts the guide on `id` directly (as if every step before it was done). */
function at(game: Game, id: GuideStepId): void {
  guideOf(game.state).step = index(id);
}

/** Adds a finished building (no event) at the free spot. */
function add(game: Game, type: string): void {
  if (!addStartingObject(game.state, type, SPOT.x, SPOT.y)) throw new Error(`could not add ${type}`);
}

describe('guide', () => {
  it('is off on a new farm until it is started, and starts on step 1', () => {
    const game = new Game();
    expect(guideInfo(game)).toEqual({ active: false, step: null, index: 0, total: GUIDE_STEPS.length, finished: false, skipped: false });
    startGuide(game);
    expect(guideInfo(game)).toMatchObject({ active: true, step: 'look', index: 1 });
  });

  it('keeps about 10–14 steps, ending on the cottage and then Finish', () => {
    expect(GUIDE_STEPS.length).toBeGreaterThanOrEqual(10);
    expect(GUIDE_STEPS.length).toBeLessThanOrEqual(14);
    expect(GUIDE_STEPS.at(-2)!.id).toBe('cottage');
    expect(GUIDE_STEPS.at(-1)!.id).toBe('done');
  });

  describe('each step advances on its event', () => {
    const cases: [GuideStepId, (game: Game) => void][] = [
      ['look', (g) => notifyGuide(g, { kind: 'camera' })],
      [
        'assign',
        (g) => {
          addFields(g, 1);
          expect(assignFarmer(g, fields(g)[0]!.id).ok).toBe(true);
          notifyGuide(g, { kind: 'state' });
        },
      ],
      [
        'sow',
        (g) => {
          addFields(g, 2);
          expect(plant(g, fields(g)[1]!, 'wheat').ok).toBe(true);
          notifyGuide(g, { kind: 'activity', name: 'planted', payload: { crop: 'wheat' } });
        },
      ],
      ['speed', (g) => notifyGuide(g, { kind: 'speed' })],
      ['develop', (g) => notifyGuide(g, { kind: 'window', id: 'development' })],
      ['field', (g) => notifyGuide(g, placed(FIELD))],
      ['harvest', (g) => notifyGuide(g, { kind: 'activity', name: 'harvested', payload: { item: 'wheat', qty: 10 } })],
      ['sell', (g) => notifyGuide(g, { kind: 'activity', name: 'sold', payload: { item: 'wheat', qty: 10, earned: 40 } })],
      ['materials', (g) => notifyGuide(g, { kind: 'activity', name: 'bought', payload: { item: 'wood', qty: 5, spent: 30 } })],
      ['granary', (g) => notifyGuide(g, placed('granary'))],
      ['cottage', (g) => notifyGuide(g, placed(COTTAGE))],
    ];
    for (const [id, act] of cases) {
      it(id, () => {
        const game = started();
        at(game, id);
        expect(stepId(game)).toBe(id);
        act(game);
        expect(stepId(game)).toBe(GUIDE_STEPS[index(id) + 1]!.id);
      });
    }

    it('a woodcutter’s lodge also does for the materials step', () => {
      const game = started();
      at(game, 'materials');
      notifyGuide(game, placed('woodcutter'));
      expect(stepId(game)).toBe('cottage');
    });

    it('the camp step waits for Next', () => {
      const game = started();
      at(game, 'camp');
      notifyGuide(game, { kind: 'camera' });
      notifyGuide(game, { kind: 'state' });
      expect(stepId(game)).toBe('camp');
      nextStep(game);
      expect(stepId(game)).toBe('field');
    });
  });

  it('walks a new farm: the camp, a first field, a granary, a cottage; no starting fields, no farmhouse store', () => {
    const game = new Game();
    expect(game.objectsOfType(FIELD)).toHaveLength(0);
    const order = GUIDE_STEPS.map((s) => s.id);
    expect(order.indexOf('camp')).toBeLessThan(order.indexOf('field'));
    expect(order.indexOf('field')).toBeLessThan(order.indexOf('assign'));
    expect(order.indexOf('granary')).toBeLessThan(order.indexOf('harvest'));
    const text = GUIDE_STEPS.map((s) => `${s.title} ${s.text}`).join(' ');
    expect(text).not.toMatch(/starting field|other field|farmhouse holds|farmhouse store/i);
    // The farmhouse only comes up as the later building it is.
    expect(text).toMatch(/level 4/);
  });

  it('ignores other events', () => {
    const game = started();
    at(game, 'develop');
    notifyGuide(game, { kind: 'window', id: 'farm' });
    notifyGuide(game, { kind: 'speed' });
    notifyGuide(game, { kind: 'activity', name: 'bought', payload: { item: 'stone', qty: 5, spent: 30 } });
    expect(stepId(game)).toBe('develop');
  });

  it('a farmer sowing their own field does not finish “sow a field yourself”', () => {
    const game = started();
    at(game, 'sow');
    addFields(game, 1);
    const [a] = fields(game);
    assignFarmer(game, a!.id);
    plant(game, a!, 'wheat');
    notifyGuide(game, { kind: 'activity', name: 'planted', payload: { crop: 'wheat' } });
    expect(stepId(game)).toBe('sow');
  });

  it('the last step waits for Finish', () => {
    const game = started();
    at(game, 'done');
    notifyGuide(game, { kind: 'camera' });
    expect(stepId(game)).toBe('done');
    nextStep(game);
    expect(guideInfo(game)).toMatchObject({ active: false, step: null, finished: true, skipped: false });
  });

  describe('a step already done is skipped when it comes up', () => {
    it('by its event, earlier', () => {
      const game = started();
      notifyGuide(game, placed('granary'));
      notifyGuide(game, { kind: 'activity', name: 'sold', payload: { item: 'wheat', qty: 1, earned: 4 } });
      expect(stepId(game)).toBe('look');
      at(game, 'harvest');
      notifyGuide(game, { kind: 'activity', name: 'harvested', payload: { item: 'wheat', qty: 10 } });
      // sell was done: straight on to materials; granary was done: skipped after it.
      expect(stepId(game)).toBe('materials');
      notifyGuide(game, placed('woodcutter'));
      expect(stepId(game)).toBe('cottage');
    });

    it('by what the farm already has', () => {
      const game = new Game();
      add(game, 'granary');
      startGuide(game);
      at(game, 'speed');
      nextStep(game);
      expect(stepId(game)).toBe('sow');
    });

    it('when the step comes up through Next', () => {
      const game = started();
      addFields(game, 1);
      assignFarmer(game, fields(game)[0]!.id);
      nextStep(game);
      expect(stepId(game)).toBe('camp');
      nextStep(game);
      // field and assign hold already: on to speed.
      expect(stepId(game)).toBe('speed');
    });

    it('at the start', () => {
      const game = new Game();
      notifyGuide(game, { kind: 'camera' }); // off: not remembered
      add(game, COTTAGE);
      startGuide(game);
      expect(stepId(game)).toBe('look');
      at(game, 'materials');
      notifyGuide(game, placed('woodcutter'));
      expect(stepId(game)).toBe('done');
    });
  });

  it('Next works on every step', () => {
    const game = started();
    for (let i = 0; i < GUIDE_STEPS.length; i++) {
      expect(guideInfo(game).index).toBe(i + 1);
      nextStep(game);
    }
    expect(guideInfo(game)).toMatchObject({ active: false, finished: true });
  });

  it('End works on every step and leaves it off', () => {
    for (const s of GUIDE_STEPS) {
      const game = started();
      at(game, s.id);
      endGuide(game);
      expect(guideInfo(game)).toMatchObject({ active: false, step: null, finished: false, skipped: true });
      notifyGuide(game, { kind: 'camera' });
      expect(guideOf(game.state).step).toBe(index(s.id));
    }
  });

  it('Skip leaves it off; Restart starts at step 1 after Skip, End or Finish', () => {
    const game = new Game();
    skipGuide(game);
    expect(guideInfo(game)).toMatchObject({ active: false, skipped: true });
    startGuide(game);
    expect(guideInfo(game)).toMatchObject({ active: true, step: 'look', skipped: false });
    at(game, 'sell');
    notifyGuide(game, placed('granary'));
    endGuide(game);
    startGuide(game);
    expect(guideInfo(game)).toMatchObject({ active: true, step: 'look' });
    expect(guideOf(game.state).done).toEqual([]);
    at(game, 'done');
    nextStep(game);
    startGuide(game);
    expect(guideInfo(game)).toMatchObject({ active: true, step: 'look', finished: false });
  });

  it('survives a save round trip on its step, with what was done early', () => {
    const game = started();
    at(game, 'speed');
    notifyGuide(game, { kind: 'activity', name: 'sold', payload: { item: 'wheat', qty: 1, earned: 4 } });
    const loaded = new Game(parseSave(serialize(game.state, 1)).state);
    expect(guideInfo(loaded)).toMatchObject({ active: true, step: 'speed' });
    expect(guideOf(loaded.state).done).toEqual(['sell']);
  });

  it('is off in a save without it (older saves, an older export)', () => {
    const game = new Game();
    delete game.state.ext[GUIDE];
    const loaded = new Game(parseSave(serialize(game.state, 1)).state);
    expect(guideInfo(loaded)).toMatchObject({ active: false, finished: false, skipped: false });
    expect(notifyGuide(loaded, { kind: 'camera' })).toBe(false);
  });

  it('repairs a broken slice', () => {
    const game = new Game();
    game.state.ext[GUIDE] = { started: true, step: 99, done: ['nope', 'sell'], finished: 'yes' };
    expect(guideInfo(game)).toMatchObject({ active: true, step: 'done', finished: false });
    expect(guideOf(game.state).done).toEqual(['sell']);
    game.state.ext[GUIDE] = 'garbage';
    expect(guideInfo(game).active).toBe(false);
  });
});
