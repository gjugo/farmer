import type Phaser from 'phaser';
import {
  ARRIVE_APPROVAL,
  CLOTH_PER_FAMILY,
  CLOTHES_PER_FAMILY,
  COTTAGE,
  FAMILIES_PER_ALE,
  FARMHOUSE_HOMES,
  FIREWOOD_PER_HOME,
  FOODS,
  LEAVE_APPROVAL,
  MEAL_PER_FAMILY,
} from '../../data/families';
import { getItem } from '../../data/items';
import { MAX_FARMERS } from '../../data/workers';
import type { FarmContext, ObjectView, PlacedObject, SheetSpec } from '../../game/context';
import { onGameStart, registerBehavior, registerDebugInfo, registerHudButton } from '../../game/hooks';
import { formatDuration } from '../../logic/crops';
import { aleWanted, clothesNeeded, familiesCount, familiesOf, homesOf } from '../../logic/families';
import type { Game } from '../../logic/game';
import { seasonOf } from '../../logic/seasons';
import { ART_RES, ART_SCALE, artFor } from '../../scenes/art';
import { packAsset } from '../../scenes/sprites';
import { h } from '../../ui/dom';
import { withIcons } from '../../ui/icons';

/**
 * Families on the map and in the HUD: the approval chip (😊 62%) opens the Families sheet with homes, families,
 * approval and its breakdown; arrivals and departures are toasted; cottages puff chimney smoke on winter days while
 * their family has firewood. Rules live in `src/logic/families.ts`, numbers in `src/data/families.ts`. The Farmers
 * sheet shows the same block (`familiesBlock`).
 */

/** A face for the approval: happy, content, unsure, unhappy. */
export function approvalFace(approval: number): string {
  if (approval >= 75) return '😄';
  if (approval >= ARRIVE_APPROVAL) return '😊';
  if (approval >= LEAVE_APPROVAL) return '😐';
  return '😟';
}

const pointsText = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

/** "🌾 Wheat ×2, 🥕 Carrot ×2" */
function foods(ate: Record<string, number>): string {
  return Object.entries(ate)
    .map(([id, n]) => `${getItem(id)?.icon ?? ''} ${getItem(id)?.name ?? id} ×${n}`.trim())
    .join(', ');
}

/** What the sheet says about the next family: when they come, or what stops them. */
function arrivalHint(game: Game): string {
  const { state } = game;
  const homes = homesOf(state);
  const families = familiesCount(state);
  const s = familiesOf(state);
  if (families >= MAX_FARMERS) return `Your farm has the most families it can (${MAX_FARMERS}).`;
  if (families > homes) return `${families - homes} of your farmers have no home of their own: build cottages for them before another family can come.`;
  if (families === homes) return 'Build a cottage to house another family.';
  if (s.approval < ARRIVE_APPROVAL) return `A home is free: a family moves in once approval reaches ${ARRIVE_APPROVAL}%.`;
  const at = s.nextArrivalAt;
  return at !== null && at > game.now ? `A home is free: a new family arrives in about ${formatDuration(at - game.now)}.` : 'A home is free: a new family is on the way.';
}

/** Homes, families, approval with its breakdown, yesterday's needs and the next arrival: for the Families and Farmers sheets. */
export function familiesBlock(game: Game): HTMLElement {
  const { state } = game;
  const s = familiesOf(state);
  const homes = homesOf(state);
  const families = familiesCount(state);
  const day = s.lastDay;
  const lastLines: string[] = [];
  if (day) {
    lastLines.push(day.eaten > 0 ? `🍽️ Ate ${foods(day.ate)} (${day.eaten} of ${day.meal})` : `🍽️ Nothing to eat (they needed ${day.meal})`);
    if (day.firewood !== null) lastLines.push(`🪵 Firewood: ${day.firewood} of ${day.firewoodNeeded} homes warm`);
    if (day.ale != null) lastLines.push(`🍺 Ale: ${day.ale} of ${day.families} families had some (${day.aleDrunk ?? 0} drunk)`);
    if (day.clothed !== null) {
      const dressed = Math.min(day.dressed ?? 0, day.clothed);
      lastLines.push(`🧵 Clothed: ${day.clothed} of ${day.families}${dressed > 0 ? ` (👕 ${dressed} in clothes, 🧵 ${day.clothed - dressed} in cloth)` : ''}`);
    }
  }
  const clothes = clothesNeeded(game)
    ? ` At the start of winter each family takes ${CLOTHES_PER_FAMILY} 👕 clothes if there are any (happier), otherwise ${CLOTH_PER_FAMILY} 🧵 cloth, and stays clothed all year.`
    : ' Once the loom is unlocked they also want 🧵 cloth each winter.';
  const ale = aleWanted(game) ? ` Each day they drink 1 🍺 ale per ${FAMILIES_PER_ALE} families while there is any.` : '';
  return h(
    'div',
    { class: 'families', 'data-testid': 'families' },
    h(
      'p',
      { class: 'families-stats' },
      h('span', { 'data-testid': 'families-homes' }, `🏡 ${homes} ${homes === 1 ? 'home' : 'homes'}`),
      h('span', { 'data-testid': 'families-count' }, `👪 ${families} ${families === 1 ? 'family' : 'families'}`),
      h('span', { class: `families-approval approval-${s.approval >= ARRIVE_APPROVAL ? 'good' : s.approval >= LEAVE_APPROVAL ? 'meh' : 'bad'}`, 'data-testid': 'families-approval' }, `${approvalFace(s.approval)} ${s.approval}%`),
    ),
    h('p', { class: 'families-hint', 'data-testid': 'families-hint' }, arrivalHint(game)),
    s.approval < LEAVE_APPROVAL && families > 1
      ? h('p', { class: 'families-warn', 'data-testid': 'families-warn' }, `Approval is below ${LEAVE_APPROVAL}%: if it stays there all day, a family leaves the farm.`)
      : null,
    h(
      'ul',
      { class: 'families-breakdown', 'data-testid': 'families-breakdown', 'aria-label': 'Approval breakdown' },
      s.breakdown.map((p) =>
        h('li', { class: p.points < 0 ? 'minus' : p.points > 0 ? 'plus' : '' }, h('span', {}, p.label), h('strong', {}, p.id === 'base' ? `${p.points}%` : pointsText(p.points))),
      ),
    ),
    lastLines.length ? h('ul', { class: 'families-day', 'data-testid': 'families-day', 'aria-label': 'Yesterday' }, lastLines.map((l) => h('li', {}, withIcons(l)))) : null,
    h(
      'p',
      { class: 'muted families-needs' },
      withIcons(
        `Each family eats ${MEAL_PER_FAMILY} food a day from the granary (${FOODS.map((id) => getItem(id)?.icon ?? id).join(' ')}): the more kinds they get, the happier they are. On winter days each home burns ${FIREWOOD_PER_HOME} 🪵 wood from the storehouse.${clothes}${ale}`,
      ),
    ),
  );
}

/** Changes whenever the block would read differently (the arrival countdown ticks in the hint, so it is coarse). */
export function familiesSignature(game: Game): string {
  const s = familiesOf(game.state);
  const left = s.nextArrivalAt !== null ? Math.ceil((s.nextArrivalAt - game.now) / 10_000) : -1;
  return `${homesOf(game.state)}|${familiesCount(game.state)}|${s.approval}|${s.settledDay}|${left}|${clothesNeeded(game)}|${aleWanted(game)}`;
}

function familiesSheet(ctx: FarmContext): SheetSpec {
  const { game } = ctx;
  return {
    id: 'families',
    title: () => '👪 Families',
    signature: () => familiesSignature(game),
    render: (body) => {
      body.append(
        h(
          'p',
          { class: 'muted' },
          'Every farmer is a family living in a home: the farmhouse or a cottage. Happy families bring more families; unhappy ones leave.',
        ),
        familiesBlock(game),
      );
    },
  };
}

registerHudButton({
  id: 'families',
  label: 'Approval',
  icon: '😊',
  onClick: (ctx) => ctx.ui.toggleSheet(familiesSheet(ctx)),
  live: (ctx) => {
    const { approval } = familiesOf(ctx.game.state);
    return { icon: approvalFace(approval), label: `${approval}%` };
  },
});

/** The running game, for the debug info (set at game start). */
let current: Game | null = null;

/** `window.farm.families`, for QA. */
registerDebugInfo('families', () => {
  const game = current;
  if (!game) return null;
  const s = familiesOf(game.state);
  const d = s.lastDay;
  return structuredClone({
    homes: homesOf(game.state),
    families: familiesCount(game.state),
    approval: s.approval,
    breakdown: s.breakdown,
    lastDay: d
      ? {
          ate: d.ate,
          variety: d.variety,
          firewood: d.firewood,
          // Families clothed this year: in the tailor's clothes and in cloth.
          clothed: d.clothed === null ? null : { families: d.clothed, clothes: Math.min(d.dressed ?? 0, d.clothed), cloth: d.clothed - Math.min(d.dressed ?? 0, d.clothed) },
          ale: d.ale == null ? null : { families: d.ale, drunk: d.aleDrunk ?? 0 },
        }
      : null,
    nextArrivalAt: s.nextArrivalAt,
  });
});

onGameStart((ctx) => {
  current = ctx.game;
  const { activity } = ctx.game;
  activity.on('familyArrived', ({ families }) => ctx.ui.toast(`👪 A new family moved in! Farmer ${families} is ready for work.`, 'success'));
  activity.on('familyLeft', ({ workplace }) =>
    ctx.ui.toast(`🧳 A family left the farm: approval stayed below ${LEAVE_APPROVAL}%.${workplace ? ' Their workplace is free.' : ''}`, 'error'),
  );
});

// Cottages ---------------------------------------------------------------------------

/** The chimney top in the cottage's 2x sprite (the Ludo.ai cottage, `tools/ludo/source/cottage_raw.png`). */
const CHIMNEY_AT = { x: 172, y: 18 };
const PUFFS = 3;

const puffsOf = new Map<string, Phaser.GameObjects.Image[]>();

/** Is a family living in this cottage? Cottages fill up in build order, after the farmhouse. */
function occupied(game: Game, obj: PlacedObject): boolean {
  if (obj.site) return false;
  const i = game.state.objects.filter((o) => o.type === COTTAGE && !o.site).findIndex((o) => o.id === obj.id);
  return i >= 0 && i < familiesCount(game.state) - FARMHOUSE_HOMES;
}

/** Smoke on winter days while the homes have firewood. */
function smoking(game: Game, obj: PlacedObject): boolean {
  const day = familiesOf(game.state).lastDay;
  return seasonOf(game.state.clock) === 'winter' && !!day && day.firewood !== null && day.firewood > 0 && occupied(game, obj);
}

registerBehavior<Record<string, unknown>>(COTTAGE, {
  create: (ctx, obj, view: ObjectView) => {
    const [ax, ay] = packAsset(artFor(COTTAGE))?.res[ART_RES].anchor ?? [0, 0];
    const at = { x: view.top.x + (CHIMNEY_AT.x - ax) * ART_SCALE, y: view.top.y + (CHIMNEY_AT.y - ay) * ART_SCALE };
    const puffs = Array.from({ length: PUFFS }, () => ctx.scene.add.image(at.x, at.y, 'proc-smoke').setVisible(false).setData('at', at));
    view.container.add(puffs);
    puffsOf.set(obj.id, puffs);
  },
  update: (ctx, obj) => {
    const puffs = puffsOf.get(obj.id);
    if (!puffs) return;
    const on = smoking(ctx.game, obj);
    // Cosmetic only, so it runs on real time.
    const t = ctx.scene.time.now;
    puffs.forEach((p, i) => {
      p.setVisible(on);
      if (!on) return;
      const a = p.getData('at') as { x: number; y: number };
      const phase = (t / 2000 + i / PUFFS) % 1;
      p.setPosition(a.x + Math.sin(phase * 5 + i) * 5 + phase * 10, a.y - phase * 40);
      p.setAlpha(0.7 * (1 - phase));
      p.setScale(0.45 + phase * 0.7);
    });
  },
  destroy: (_ctx, obj) => void puffsOf.delete(obj.id),
  panel: (ctx, obj) => {
    const { game } = ctx;
    const home = occupied(game, obj);
    const { approval } = familiesOf(game.state);
    return {
      title: 'Cottage',
      icon: '🛖',
      lines: obj.site
        ? ['Being built: a free farmer builds it, then a family can move in.']
        : home
          ? [`Home of a family. Their farmer sets out from the farmhouse door like everyone else.`, `${approvalFace(approval)} Approval ${approval}% (see 👪 Families).`]
          : [`Empty. ${arrivalHint(game)}`],
    };
  },
});
