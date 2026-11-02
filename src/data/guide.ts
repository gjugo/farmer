/**
 * The first-session guide's steps: what each card says and what it points at. What finishes a step is in
 * `src/logic/guide.ts` (by the step's `id`); the card, ring and map marker are drawn by `src/features/guide`.
 */

export type GuideStepId =
  | 'look'
  | 'camp'
  | 'field'
  | 'assign'
  | 'speed'
  | 'granary'
  | 'sow'
  | 'develop'
  | 'harvest'
  | 'materials'
  | 'post'
  | 'sell'
  | 'cottage'
  | 'done';

/**
 * Something on screen a step's ring goes round, tried in order: the first one shown wins.
 * - `'btn-build'`: the element with that `data-testid`;
 * - `'sell-all-*'`: the first element whose `data-testid` starts with `sell-all-`;
 * - `'action:Assign a farmer'`: the open panel's action button whose label contains the text.
 */
export type GuideRingTarget = string;

/**
 * Where a step's map marker stands: the village centre (in front of the camp's tent on a new farm), a field without a
 * farmer, an empty field without a farmer, a ripe field.
 */
export type GuideMapTarget = 'centre' | 'field-free' | 'field-empty' | 'field-ripe';

export interface GuideStepDef {
  id: GuideStepId;
  title: string;
  /** One or two short sentences, naming the hotkey. */
  text: string;
  ring: readonly GuideRingTarget[];
  /** A pulsing marker on the map, shown while no sheet is open. */
  map?: GuideMapTarget;
  /** No ring on an action of an open panel whose lines contain this text (e.g. the field that has a farmer). */
  ringUnless?: string;
}

export const GUIDE_STEPS: readonly GuideStepDef[] = [
  {
    id: 'look',
    title: 'Look around',
    text: 'Drag the map or use WASD to move; the mouse wheel or a pinch zooms. The chips top left count your farmers, homes, approval and supplies.',
    ring: ['hud-overview'],
  },
  {
    id: 'camp',
    title: 'Your camp',
    text: 'Two families live in the ⛺ tent. Its supplies of food, 🪵 wood and 🪨 stone feed them and pay for your first buildings: tap the tent to see what is left.',
    ring: [],
    map: 'centre',
  },
  {
    id: 'field',
    title: 'Build a field',
    text: '🔨 Build (B) → 🌾 Farming → Field. The ghost turns green where a path from the camp reaches it: lay one from the path in front of the tent with 🛤️ Paths (P).',
    ring: ['build-field', 'build-cat-farming', 'btn-build'],
  },
  {
    id: 'assign',
    title: 'Put a farmer to work',
    text: 'A free farmer builds the field. Tap it, then 👨‍🌾 Assign a farmer: they plough, sow (🌱 Best in season) and harvest it by themselves.',
    ring: ['action:Assign a farmer'],
    map: 'field-free',
  },
  {
    id: 'speed',
    title: 'Speed up time',
    text: 'Work and crops take time: ⏩ ×4 or ⏭ ×12 (keys 1–3) speed it up. ⏸ or Space pauses.',
    ring: ['speed-12'],
  },
  {
    id: 'granary',
    title: 'Build a granary',
    text: 'The camp only holds its own supplies: your harvest needs a 🌾 Granary (🔨 → 📦 Storage), room for 100 goods. A free farmer builds the site.',
    ring: ['build-granary', 'build-cat-storage', 'btn-build'],
  },
  {
    id: 'sow',
    title: 'Sow a field yourself',
    text: 'Build a second field, tap it and pick 🌾 Wheat. Your other farmer walks over and sows it; if both are busy, try again in a moment.',
    ring: ['action:Wheat ·'],
    map: 'field-empty',
    ringUnless: 'works here ·',
  },
  {
    id: 'develop',
    title: 'Your farm’s level',
    text: 'Tap ⭐ the level for Development: 🎯 Goals pay money and XP, so claim the finished ones.',
    ring: ['btn-level'],
  },
  {
    id: 'harvest',
    title: 'Bring in the harvest',
    text: 'Your farmer harvests ripe wheat (or tap it → Harvest) and stores it in the granary. The resource bar shows what you hold.',
    ring: ['action:Harvest', 'hud-resources'],
    map: 'field-ripe',
  },
  {
    id: 'materials',
    title: 'Wood and stone',
    text: 'Buildings need 🪵 wood and 🪨 stone. Your ⛺ camp’s supplies come first (tap it to see what is left); for more, build a 🪓 Woodcutter’s Lodge near trees and assign a farmer (the Market opens once a trading post is linked).',
    ring: ['build-woodcutter', 'build-cat-resources', 'btn-build'],
  },
  {
    id: 'post',
    title: 'Build a trading post',
    text: 'Trade needs a 🏪 Trading Post (🔨 → 📦 Storage) linked to the 🛣️ main road near the map’s edge: lay 🛤️ Paths from the camp (or the farmhouse) to the post and on to the road.',
    ring: ['build-trading-post', 'build-cat-storage', 'btn-build'],
  },
  {
    id: 'sell',
    title: 'Sell at the trading post',
    text: 'Once the post is linked, ⚖️ Trade (T) → 🏪 Market sells your crops. Past the daily allowance prices drop, so sell a little each day.',
    ring: ['sell-all-*', 'btn-trade'],
  },
  {
    id: 'cottage',
    title: 'Homes for your families',
    text: 'The tent is packed away once its supplies are used up and its families have room in 🛖 Cottages (🔨 → 🏠 Homes). Approval of 50% or more (food, firewood in winter) brings more families: 👪 Farm (F) → Families.',
    ring: ['build-cottage', 'build-cat-homes', 'btn-build'],
  },
  {
    id: 'done',
    title: 'You’re set!',
    text: 'At level 4 you can build the 🏠 Farmhouse, the heart of the farm: more storage, a home and approval, growing into a manor house and a manor hall. 📖 Almanac (H) warns of hazards, every level-up offers a perk, and ⚙️ Menu → Settings restarts this guide.',
    ring: ['btn-almanac'],
  },
];
