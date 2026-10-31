import { FALLOW_GAIN_PER_DAY, MANURE_GAIN, MANURE_PER_SPREAD, SOIL_INFO, type SoilBand } from '../../data/soil';
import { FERTILISE_WORK_MS } from '../../data/workers';
import type { FarmContext, PanelAction, PanelSpec, PlacedObject } from '../../game/context';
import { withFarmer } from '../../game/workers';
import { checkFertilise, cropStage, fertilise, fertilityOf, fieldCrop, fieldSoil, lastCropOf, type FieldState } from '../../logic/crops';
import { drainOf, soilBand } from '../../logic/soil';

/** The fertility bar is green at a good level, yellow when worn, red when spent. */
function fertilityBand(fertility: number): SoilBand {
  return fertility >= 80 ? 'rich' : fertility >= 55 ? 'normal' : 'poor';
}

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const pct = (n: number) => `${Math.round(n)}%`;

/**
 * The soil block of a field's panel: its fertility as a bar, the quality of its land, its last crop and a short hint
 * on what wears it out or brings it back.
 */
export function soilPanel(ctx: FarmContext, obj: PlacedObject<FieldState>): Required<Pick<PanelSpec, 'lines' | 'meters' | 'hint'>> {
  const clock = ctx.game.state.clock;
  const fertility = fertilityOf(clock, obj);
  const soil = fieldSoil(obj);
  const band = SOIL_INFO[soilBand(soil)];
  const last = lastCropOf(obj.state);
  const crop = fieldCrop(obj.state);
  let hint = 'Same crop again drains twice as fast.';
  if (crop && cropStage(clock, obj.state) !== 'empty') {
    const drain = drainOf(crop.id, crop.soilDrain, obj.state.lastCrop ?? null);
    hint = crop.id === last?.id ? `${crop.name} again: this harvest drains twice as fast (−${drain}%).` : `This harvest takes ${drain}%. ${hint}`;
  } else if (fertility < soil) {
    hint = `Resting: +${FALLOW_GAIN_PER_DAY}% a day back to ${pct(soil)}. ${hint}`;
  }
  return {
    meters: [{ id: 'fertility', label: '🌱 Fertility', value: fertility / 100, text: pct(fertility), color: css(SOIL_INFO[fertilityBand(fertility)].color) }],
    lines: [`${band.icon} ${band.name} soil (${pct(soil)}) · Last crop: ${last ? `${last.icon} ${last.name}` : 'none yet'}`],
    hint,
  };
}

/** "💩 Spread manure (4)": a free farmer forks manure over an empty field, +20% fertility. */
export function manureAction(ctx: FarmContext, obj: PlacedObject<FieldState>): PanelAction {
  const { game } = ctx;
  const check = checkFertilise(game, obj);
  const why = check.ok ? `+${MANURE_GAIN}%` : check.reason === 'fertile' ? 'fertility is full' : `you have ${game.count('manure')}`;
  return {
    label: `💩 Spread manure (${MANURE_PER_SPREAD}) · ${why}`,
    variant: 'secondary',
    disabled: !check.ok,
    onClick: () => {
      const again = checkFertilise(game, obj);
      if (!again.ok) {
        ctx.ui.toast(again.reason === 'manure' ? `Needs ${MANURE_PER_SPREAD} 💩 Manure: collect from your coops and pastures` : 'The field is as fertile as it gets', 'error');
        return;
      }
      withFarmer(ctx, 'fertilise', obj, FERTILISE_WORK_MS, () => {
        const r = fertilise(game, obj);
        if (r.ok) ctx.ui.floatText(obj.x + 0.5, obj.y, `🌱 ${pct(r.fertility)}`, '#c8ff9e');
        return r.ok;
      });
    },
  };
}
