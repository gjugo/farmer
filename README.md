# farmer

A cheerful 2D farming game for the browser, built with **Phaser 4**, **Vite** and **TypeScript**.
Grow the farm, build fields and pastures, raise animals, turn crops and animal products into
milk, cheese, eggs and more, and sell them to expand.

## Running it

```bash
npm ci
npm run dev                          # http://localhost:5173
npm run dev -- --port 5243 --strictPort
```

| Script              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Vite dev server with hot reload                |
| `npm run build`     | Typecheck and production build into `dist/`    |
| `npm run preview`   | Serve the production build                     |
| `npm run typecheck` | `tsc --noEmit` (strict)                        |
| `npm run lint`      | ESLint                                         |
| `npm test`          | Vitest unit tests (`src/**/*.test.ts`)         |
| `npm run art`       | Regenerate `public/assets/farm/` from its Python source ([tools/art](tools/art/README.md); needs Python 3.12+ and cairo, not part of CI) |

CI (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, lint, test and build on every PR and on `main`.

### Controls

- **HUD** (laid out like Manor Lords'):
  - **Top left, farm overview:** icon-and-number chips for 🧑‍🌾 free farmers, 👷 working farmers, 🏠 free home room
    ("(+1)" while a cottage is being built), 😊 approval, 🐄 livestock and 🧺 **supplies** (days of food left at today's
    use; in winter the lower of food and firewood, shown with 🪵 when firewood runs out first). Hover or tap a chip for
    what it is and a breakdown; click it (on a phone: tap again) to open its tab.
  - **Top centre:** ⭐ the level with its XP bar (hover: XP to the next level and what it unlocks; click: the
    **Development** window, 🎯 Goals and ⭐ Perks, badged with claimable goals and open perk choices). Under it,
    **banners** coloured by severity: a perk to choose (blue), the trader tomorrow (blue) or here (amber), a hazard
    announced (amber) or on now (red); a tap opens its tab. 🕮 next to the level lists the last 30 messages with their day.
  - **Top right:** the resource bar (the materials chip lights up while placing a building) and 💰 money.
  - **Bottom right:** the season and "Day 12" (hover or tap: "Summer, day 3 of 4" and the crops you can sow now), and
    the speed: ⏸ / ▶ ×1 / ⏩ ×4 / ⏭ ×12. The player's pause is separate from the menu's: closing the menu keeps it.
    The speed isn't saved (loading starts at ×1, playing); debug speeds and the offline catch-up are unchanged.
  - **Bottom centre, the tool bar:** 🛤️ Paths, 🔨 Build (the construction menu), 👪 Farm (Families · Farmers ·
    Storage), ⚖️ Trade (Market · Orders · Trader, the Trader tab only while he is announced or here), 📖 Almanac and
    ⚙️ Menu. A tab's badge shows on its tab and its button.
  - **Construction menu:** category icons over the tool bar (🪓 Resources · 📦 Storage · 🏠 Homes · 🌾 Farming ·
    ⚒️ Crafts · 🧹 Demolish), a parchment panel of picture cards above them (each building's own sprite in the current
    season; hover, or the line under it on a touch screen, gives the name, cost and what is missing; locked cards are
    grey with 🔒 Lv N; on a phone they scroll sideways), and the 🌱 Soil checkbox above that. It remembers the last
    category. A building's category is its `category` in its data.
  - Windows and an object's action panel share one sheet: on the right on a desktop, a full-width bottom sheet above
    the tool bar on a phone. One at a time.
- **Keys:** P paths, B build menu, X demolish, F Farm, T Trade, H Almanac, M sound on/off, Space pause, 1/2/3 speed
  ×1/×4/×12. They do nothing while a dialog or the menu is open. **Esc** closes the topmost thing: a tip or the recent
  events, then a tool (back to the construction menu if it was picked there), then the construction menu, then a
  window; with nothing open it opens the pause menu.
- **Pan:** drag the map, or WASD / arrow keys. **Zoom:** mouse wheel or pinch.
- **Build:** 🔨 Build → a category → a card → click/tap a tile. A green ghost means the spot is valid (and a path from the
  farmhouse reaches it). Esc, right-click or **Cancel** leaves build mode. Each item shows its money cost and the
  **building materials** it takes (🪵 wood, 🪨 stone, 🔩 iron); what you can't pay for is greyed out with what is missing
  ("Needs 4 more 🪵 Wood"), its ghost turns red, and placing it says to buy the rest at the 🏪 Market.
  Paths, fields and the woodcutter's lodge cost money only; coops, pastures and processing buildings need wood and/or
  stone, and the dairy and loom also need iron. Money and materials are paid on placing. Paths are laid at once; everything
  else becomes a **construction site** (drawn faded, with 🚧 and a progress bar) that a free farmer walks to and builds:
  1.5 game-s per footprint tile, 3–20 s. A site can't be used until it is finished; its panel shows the build only.
- **Demolish:** 🧹 → click an object, or **Demolish** in its panel (which asks first and says what comes back).
  Gives back 50% of its money cost and 50% of its materials (rounded down; an unfinished site gives back everything),
  materials only as far as the storehouses have room: the confirm says what would be lost (demolish mode asks first too when something would be lost).
  A granary or storehouse can't be demolished while its stock wouldn't fit without it ("Sell or use 40 goods first").
- **Storage:** everything the farm holds needs room. **Goods** (crops, eggs, milk, wool, feed, cheese, bread, …) go
  in **granaries**, **materials** (wood, stone, iron) in **storehouses**; the farmhouse holds 30 of each on top, and a
  new farm's ⛺ **camp** adds room for what is left of its starting supplies (see **Starting camp**), so they fit from
  the start and that room shrinks as they are used (nothing new is ever stored there). A
  granary holds 100 / 250 / 500 goods at level 1 / 2 / 3 ($30 + 5 🪵 to build), a storehouse 60 / 150 / 300 materials
  ($60 + 8 🪵 + 8 🪨). Click one for its panel: level, the pool's used/capacity, what is stored, and **Upgrade** with its
  cost (level 3 needs 🔩 iron) or why it can't be done yet. An upgrade keeps a farmer busy like building. The level
  shows on the map (each level has its own art, plus an "Lv 2" badge). A granary or storehouse holds nothing while it is
  still a construction site. 👪 Farm → 📦 Storage shows both pools as bars, warns
  from 90% and says clearly when one is full. Wherever items come in, only what fits goes in: a harvest is refused
  ("The granary is full: …") and the crop stays ripe in the field; eggs, milk and wool stay in the pen and finished
  goods in their building until there is room (Collect takes what fits and says what is left); a feed pack is refused
  and materials bought at the Market are capped at the room left; debug **+10** adds what fits. An assigned farmer
  doesn't harvest or collect what won't fit: the Farmers sheet says the granary is full, and a pen's farmer still feeds
  and a building's farmer keeps the queue going meanwhile. Selling, fulfilling
  orders and starting processing jobs free room at once. Time away only moves goods into pens and buildings, as
  always. Saves from before storage keep everything, even above capacity, but nothing new comes into an over-full
  pool until it is back under; a one-time toast suggests building a granary.
- **Resource bar:** top right, one chip per category with its total: 🌾 crops (wheat, carrot, potato, corn, barley, flax, cabbage, pumpkin), 🥚 animal
  products (egg, milk, wool), feed, 🧀 goods (cheese, butter, bread, cloth, malt, ale, linen, clothes) and 🪵 materials (wood, stone, iron), plus the
  room used in each pool (goods `used/capacity` after the four goods chips, materials after Materials), green, amber
  from 90% and red when full, like 📦 Storage. Hover a chip (mouse) or tap it for each item's icon and count; Esc or a
  tap outside closes it. When a count changes the chip shows **+N** in green or **−N** in red for a moment (harvests,
  sales, building costs, processing). Categories come from `RESOURCE_CATEGORIES` in `src/data/resources.ts`: an item
  falls into one by its `category`, so new items need no change there.
- **Stock in the world:** what the farm holds is stacked in the yards: logs, stone blocks and iron bars in front of a
  storehouse; sacks and baskets of crops, egg baskets, milk churns and wool bales, feed sacks and crates of cheese,
  bread and cloth in front of a granary; a small pile of goods and one of materials beside the farmhouse; logs, stone,
  crop sacks and bread crates around the camp's tent, each shrinking from full as that supply is used. Each pile has
  4 fill stages (a quarter … full) and none when empty. Stock is one pool per kind, so the display splits it: the
  camp shows what is left of its supplies, the farmhouse store fills first with the rest, then each finished granary or storehouse in placement order, up to its room (purely
  visual, `stockDisplay` in `src/logic/stockpiles.ts`). In a building the biggest pile shows how full it is and the
  others are scaled to it, so a full building looks full. Construction sites show none.
- **Market:** 🏪 Market sells anything in the inventory at today's price (**Sell everything** keeps building
  materials, manure and the blacksmith's tools; tools sell for about $40, but the Market never sells them). Its **Buy building materials** section sells wood, stone and (from level 3) iron: **Buy 1/5/10**, or
  pick any amount with the − / + stepper. It shows the storehouse room left; a purchase is capped at that room
  ("Bought only 5 …") and refused when there is none. Buy prices change daily like sell prices and are always above anything the
  Market pays, so buying and selling back loses money (and selling materials gives no XP). Too little money: the
  purchase is refused with a toast. New farms start with the camp's 40 wood and 20 stone; the goal "Buy 10 wood" comes just before
  "Build a cottage" and "Build a chicken coop". "House 4 families" follows "Reach level 3".
- **Market rules (saturation):** the Market takes each item's daily allowance, worth about $150 at its base price
  (`floor(150 / base)`: 37 wheat, 15 eggs, 3 cheese), at the day's price. Every unit sold past it lowers that item's
  price by 1%, down to 50% of the day's price; each new day takes a quarter of the drop away (exact integer basis
  points, so live play, ×60 and offline catch-up give the same prices) and the allowance starts again. Drops are saved
  (`ext.market`). The sell list shows the current price with a blue **Flooded −N%** mark; **Sell all** and **Sell
  everything** ask first when the sale would flood, with the total at the falling prices. Selling never pays more than
  the Market's buy price. Orders board rewards and the travelling trader are not affected.
- **Travelling traders:** from level 3, about twice a season (one day in each half of a season) a trader's wagon parks
  for one game day on a free owned tile next to the farmhouse door (or the nearest path tile). He is announced the day
  before with a toast and a **🛒 Trader tomorrow** banner under the level, which becomes **🛒 Trader here** while he
  stays; tapping the banner or the wagon opens his tab in ⚖️ Trade. He buys 2–3 goods the farm can already make (its unlocked crops,
  animals' products and processed goods) at +40–80% of base price, each up to a set quantity (about $240 worth), with no
  saturation; and sells 2–3 offers, each with stock: a building material below the Market's buy price (never below what
  the Market pays for it), an unlocked animal at −25% (into a pen with room), and bulk feed. Purchases are capped at the
  storage room left, like the Market. The schedule and offers follow from a saved farm seed (`ext.trader.seed`) and the
  day, so reloads never reroll them; a trader due while the player is away comes and goes without trading, and the
  welcome-back summary says so. The last goal is "Trade with a travelling trader".
- **Wood, stone and iron from the farm:** the **🪓 Woodcutter's Lodge** (level 1, $80) makes 4 🪵 wood, the **⛏️ Quarry**
  (level 2, $120 + 10 🪵) 3 🪨 stone and the **⚒️ Mine** (level 4, $140 + 15 🪵 + 10 🪨, never iron) 1 🔩 iron per cycle
  of work: 4, 5 and 6 game-minutes, a quarter longer in winter. Nothing is made without an assigned farmer
  (**👨‍🌾 Assign a farmer to cut wood**, … to quarry stone, … to mine iron) and a path from the farmhouse: the farmer
  walks there, works one cycle (chips or dust fly by the building) and the yield lands in the building's **yard**, a
  pile of logs, stone or iron at the building that grows as it fills. **The yard rule:** a yard holds 3 cycles' yield
  (12 wood, 9 stone, 3 iron). An ox barn's cart hauls it away (see **Oxcarts**); once the yard is full, the
  building's own farmer carries all of it into the stores on foot (a `collect` job) before working another cycle, and
  with nothing left to work (no tree in reach, the deposit used up) they carry in what is left. When the storehouses
  have no room, the full yard waits, no new cycle starts and the farmer is free for other work. The panel's **Carry …
  to the storehouse** takes what fits by hand. Nothing is lost. The panel shows the farmer, the cycle's progress, the
  yard, what was made today and why it is idle (no farmer, no path, yard and storehouse full). It pays for itself in
  well under two hours of work against Market prices, so the Market is the dearer fallback. The welcome-back summary
  lists what was produced (stored, or waiting in the yards). Goals: "Build a woodcutter's lodge", "Produce 20 wood" and
  "Build a quarry" come after "Buy a plot of land", "Mine 5 iron" after "Mill 12 feed" (a lodge or quarry built
  earlier counts).
- **Oxcarts:** the **🐂 Ox Barn** (level 3, 3×2, $250 + 30 🪵 + 15 🪨; several allowed) hauls goods by oxcart. Buy an
  ox in its panel (**🐂 Buy an ox**, $300; the ox needs no feed) and assign one farmer as the carter (**👨‍🌾 Assign a
  carter**, one farmer per workplace). The carter walks from the farmhouse to the barn, then the cart leaves along the
  paths to the **fullest yard** (or the processing building with the most finished goods), loads up to **20** units,
  drives to the **nearest granary, storehouse or farmhouse store** with room for them, unloads, and drives back to the
  barn; the carter walks home. The ox pulls the cart at 0.6 game-s a tile (a farmer walks at 0.4); loading and
  unloading take 10 s each. The goods are counted where they are: in the yard until loaded, on the cart until
  unloaded (the resource bar rises on unload), and what didn't fit stays on the cart, parked in the barn, until a
  later trip takes it to a store with room. Carts empty the yards before they fill, so the farmers there keep
  producing. On the map an ox pulls the cart in four facings with the carter walking beside it and the load on the
  cart (logs, stone, iron, or sacks for goods). The barn panel says why the cart waits: **No ox**, **No carter**,
  **Nothing to haul**, **No path to …** or **Stores full**. It all runs in the work scheduler, so ×1, ×60 and offline
  catch-up agree. Goals: "Build an ox barn" and "Haul 100 goods by cart" (the last two in the list).
- **Resources on the map:** wood, stone and iron come from real places. A new game generates (from a seed) and saves
  forests, stone outcrops and iron veins: a grove of about 10 trees and a 2×2 outcrop on the starting land, large
  forests and more outcrops (2×2 or 3×3) on locked land, and at least two iron veins, only on locked land, one in a
  parcel next to the start. Bushes and ponds stay decorative; trees and deposits stay when their land is bought.
  - Each forest is a conifer wood (pine and spruce), a broadleaf wood (oak and beech) or a mixed one; birches favour
    forest edges, willows grow only near ponds (with a decorative willow or two beside each pond), and apple trees are
    rare (the start grove and forest edges). Species is looks only: every tree gives the same wood. Neighbouring trees
    differ a little in size, facing and tint. All of it follows from where a tree stands, so nothing is saved.
  - A **lodge** works the trees within 6 tiles of its footprint: each cycle fells the nearest grown tree in range, which
    becomes a stump when the cycle ends and grows back about a season (32 game-minutes) later, showing as a sapling
    from a third of that and a young tree from two thirds. With no grown tree in
    range it waits (*no grown tree within 6 tiles*), the panel says when the next one grows back, and its farmer sets
    off again then. The build ghost shades the tiles it reaches and counts the trees there.
  - A **quarry** must stand on a stone outcrop and a **mine** on an iron vein (at least one footprint tile on it); the
    build ghost outlines the deposits and is red elsewhere. Deposits are finite (an outcrop 400 stone, a 3×3 one 600,
    a vein 150 iron) and each cycle takes its yield from them; the panel shows what is left. A used-up deposit stops
    the building (*Deposit used up*), turns to rubble, and the building can be demolished. The Market stays the
    fallback.
  - Grown trees and deposits block building (the ghost says why under it); stumps and rubble don't, and building over
    them clears them for good. Regrowth and depletion follow game time, worked out from the stored times, so ×60, ×1
    and time away give the same map.
- Click an object to open its action panel.
- **Land:** the map is 64 × 48 tiles and a new farm owns the 16 × 12 in its middle. The game opens on the owned land
  with about 2 tiles around it (on a phone it stays close enough that a tile is at least 40 px wide, centred on the
  farmhouse); zooming out goes as far as the whole map. The rest of the map is cut into parcels of up to 12 × 12 tiles,
  and the ones next to your land carry a "For sale" sign: the first costs $1,000, each one after ×1.25. Saves from
  before the map grew load in the middle of the bigger map with their farm unchanged, the whole new starting land,
  and every parcel they owned part of.
- **Animals:** build a Chicken Coop or Pasture, open it to buy animals and feed. Fed animals produce
  after their cycle (chicken 3 game-minutes, cow 6, sheep 8); click the pen (or **Collect**) to pick up eggs, milk and wool.
- **Processing:** build a Feed Mill, Dairy, Bakery, Loom, Blacksmith, Malthouse, Brewery or Tailor, open it and pick a recipe.
  Inputs are taken at once; up to 3 jobs queue and run one at a time (feed 2 game-minutes, butter 4, bread 5,
  malt 5, tools 6, cheese 8, linen 8, cloth 10, ale 10, clothes 10). The longer chains:

  | Building | Level | Size | Recipes |
  | --- | --- | --- | --- |
  | 🧵 Loom | 5 | 2×2 | 2 wool → 1 cloth ($75); 3 flax → 1 linen ($60, from level 6, when flax unlocks) |
  | 🔨 Blacksmith | 5 | 2×2 | 1 iron + 1 wood → 1 🛠️ tools ($40 at the Market, which never sells them): farmers use them. Costs $280 + 10 wood + 10 stone (no iron). **⚙️ Keep making** stops once the store holds (counting batches under way) as many tools as the farm has farmers: "Enough tools in store (8/8)" |
  | 🫘 Malthouse | 6 | 2×2 | 3 barley → 2 malt ($12) |
  | 🍺 Brewery | 7 | 3×2 | 2 malt → 1 ale ($90): families drink it |
  | 👕 Tailor | 8 | 2×2 | 2 cloth → 1 clothes, or 2 linen → 1 clothes ($150): families wear them |

  So barley → malt → ale, wool → cloth or flax → linen → clothes, and mine → blacksmith → farmers. Goals: "Malt barley
  into 10 malt", "Brew 5 ale", "Sew 3 clothes", then (the last two in the list) "Build a blacksmith" and "Forge 5 tools".
  Click the building (or **Collect**) to pick up finished goods.
- **Orders:** 📋 Orders shows 3 customer orders for goods you have had before. Fulfil hands over the goods
  for a reward above today's market value; the HUD badge counts orders you can fulfil now. A fulfilled slot
  gets a new order after 8 game-minutes, a discarded one after 20.
- **Crops:** tap an empty field → pick a crop (paid in money). Each takes a real part of its season; yields are on
  normal soil:

  | Crop | Level | Sown in | Grows | Yield | Drain | Notes |
  | --- | --- | --- | --- | --- | --- | --- |
  | 🌾 Wheat | 1 | spring, summer, autumn | 8 min | 10 | 8 | food; bakery and feed mill |
  | 🥕 Carrot | 2 | spring, autumn | 10 min | 10 | 5 | food |
  | 🥔 Potato | 3 | spring, summer | 12 min | 14 | 15 | food; drains the soil hard |
  | 🌽 Corn | 4 | spring, summer | 16 min | 12 | 12 | food; feed mill |
  | 🌿 Barley | 4 | spring, summer | 9 min | 10 | 6 | feed mill (2 barley → 4 feed) |
  | 🪻 Flax | 6 | spring, summer | 14 min | 8 | 10 | loom (3 flax → 1 linen) |
  | 🥬 Cabbage | 6 | autumn (grows into winter) | 35 min | 10 | 9 | food; **the winter crop** |
  | 🎃 Pumpkin | 7 | summer, autumn | 25 min | 6 | 13 | food; the best price |

  Tap a growing field for its progress; tap a ripe (swaying, sparkling) field to harvest into the inventory.
  Goals, after "Weave 2 cloth": "Harvest 30 potatoes", "Harvest cabbage in winter" (only a winter harvest counts) and
  "Grow 10 pumpkins".
- **Soil:** the ground's quality differs across the map, in blobs: **rich** (95%), **normal** (70%) and **poor** (45%).
  It is the same on every load (worked out from a fixed seed, never saved). Rich ground grows lusher grass in every
  season; the starting land has one rich patch, under and in front of the starting fields, and is mostly normal
  elsewhere. Tick **🌱 Soil** above the 🔨 Build menu's cards to see the quality over your land (green, yellow, red); while
  placing a field its ghost is tinted the same way, tile by tile.
  - **Fertility** (0–100%): a new field starts at the average soil quality of its tiles. A harvest yields
    `round(qty × (0.5 + 0.75 × fertility))`: about ×1.0 on normal soil, ×1.2 rich, ×0.85 poor, ×0.5 when spent.
    Each harvest drains the crop's own amount ("Drain" above, e.g. wheat 8, carrot 5, corn 12 points), **twice that when it is the same crop
    as the field's last harvest**: rotate. An empty field rests and regains 6 points per game day (winter counts), up to
    its soil quality. The field panel shows the fertility bar, the soil, the last crop and a hint.
  - **Fallow:** the crop plan **Fallow (rest the soil)** (formerly "None") leaves an assigned field empty to recover.
    **Best in season** sows a crop other than the field's last one whenever one can be sown.
  - **Manure:** coops and pastures leave 1 💩 manure per animal each time their products are collected. It sells for $1
    and is kept in the storehouse (it never crowds out food; "Sell everything" keeps it). **💩 Spread manure (4)** in an
    empty field's panel sends a farmer (20 s) to spread 4 manure: +20 points, up to 100% (above its soil quality too).
    An assigned farmer spreads it by themselves on an empty field below 80% when 4 or more are in stock, before
    ploughing. Goal: "Spread manure on a field" (after "Own 2 cows").
- **Farmers:** building, ploughing, planting, harvesting, spreading manure, feeding, collecting, starting a batch and a resource cycle each keep a farmer
  busy for a while: ploughing a field 40 game-seconds, sowing 30 s, harvesting 40 s, spreading manure 20 s, feeding a pen 20 s, collecting or
  starting a batch 20 s, building 15 s per footprint tile (30 s–3 min; paths need no farmer), plus the walk there and
  back. The farm starts with one farmer; more come as families moving into cottages (below), up to 20.
  - **Workplaces:** fields, coops, pastures, processing and resource buildings take one farmer each. Assign one with
    **👨‍🌾 Assign a farmer** in the object's panel (or **Unassign**), or pick each farmer's workplace in 👪 Farm → 👨‍🌾 Farmers
    sheet, which lists every farmer with their workplace and what they are doing now. A farmer works at one place.
  - **Automatic work:** an assigned farmer does the next job there by themselves. A **field** gets manure when it is
    worn (below 80%, with 4 in stock), is ploughed (in a ploughing season), sown with its **🌱 Crop plan** (a crop,
    **Best in season**, the default: the longest grower that is ripe before its seasons end, rotating away from the
    last crop, or **Fallow**) and harvested when ripe; ploughing and seed are paid as by hand, and the
    work waits while money is short. A **coop or pasture** gets its products collected and its hungry animals fed from
    stock (it waits without feed). A **processing building** keeps queueing its **⚙️ Keep making** recipe while the
    inputs are in stock and the queue has room, and its finished goods are collected. A **woodcutter's lodge, quarry or
    mine** works cycle after cycle. The panel says why a farmer waits.
  - **Free farmers** (no workplace, or nothing to do there now) build construction sites, oldest first, and take what
    you tap: an unassigned workplace works by hand, and any free farmer does the job (one without a workplace first).
    When work appears at their own workplace again, they go back after their current job. When every farmer is busy,
    tapped work is refused until one is free.
  - **Tools** (from the blacksmith, level 5; rules in `src/logic/tools.ts`, numbers in `src/data/tools.ts`): every
    farmer has a tool slot. A farmer setting off on a job with an empty slot takes a set of 🛠️ tools from the
    storehouse if there is one. With tools, the work of building, ploughing, sowing, harvesting, spreading manure,
    feeding, collecting, starting a batch, cutting wood, quarrying and mining takes 1/1.25 of the time (25% faster,
    multiplying with perks such as Master builder); a resource cycle and a site's finish come that much sooner too.
    Walking (Good boots), hauling (the ox), processing batches (Quick hands) and animal cycles don't change. A set
    lasts **30 jobs**: each job started with it uses one, and at 0 it breaks as that job ends; the next job takes a new
    set if there is one. Without tools in store farmers work at their normal speed; nothing is ever refused for lack
    of tools. The 👨‍🌾 Farmers sheet shows "Tools: 6 of 8 farmers equipped · 3 in store" and each farmer's "🛠️ 18/30"
    or "no tools"; when tools break with none left in store, a toast (at most once a game day) says "Tools are
    wearing out: forge more at the blacksmith". An 8-farmer farm keeping everyone equipped burns about 1.5 iron a
    season, half of what one mine digs (`src/logic/balance.test.ts`).
  - The work runs on game time, so speed ×60 and offline catch-up give the same farm; the welcome-back summary
    reports what the farmers harvested, sowed, collected, made, produced and built while you were away, and the tools
    forged and worn out.
- **Families:** every farmer is a family living in a home: the farmhouse houses the first, each **🛖 Cottage** (2×2,
  $80 + 8 wood, level 1, built by a farmer like any site) one more. There is no hiring for cash. When a home is free
  and approval is at least 50%, a family moves in half a day after the home became free (at most one a day); its
  farmer starts free, without a workplace, and sets out from the farmhouse door like everyone. When approval stays
  below 25% for a whole game day, the last family leaves (its farmer goes and its workplace is freed; never the last
  family), and its home stands empty. At every day boundary (8 game-minutes) the families settle their needs from
  storage: each eats **2 food** from the granary (wheat, carrot, corn, potato, cabbage, pumpkin, apple, egg, milk, bread,
  cheese, butter; never feed, barley, flax, wool, cloth, malt or ale), spread across the kinds in stock; on **winter** days each occupied home burns **1 wood**; once the
  loom is unlocked (level 5) each family takes **1 clothes** from the tailor at the start of winter if any are in stock,
  otherwise **1 cloth**, and stays clothed until the next. Once the brewery is unlocked (level 7) they drink **1 ale per
  2 families** a day while there is any.
  **Approval** (0–100%) comes from that day: base 50, +5 per food kind eaten beyond the first (up to +20), −20 short of
  food, −50 with nothing to eat, up to +10 when every family is clothed in cloth (+15 in clothes; mixed, by share), up to
  +10 when every family had ale (by share), and in winter +10 when every home is warm or up
  to −60 when homes are cold (by the share of cold homes); from level 2, up to +5 when every home has a house garden
  (a share of it when some do). A new farm's families eat the bread and carrots of the starting camp (about 5 days
  for the first three families), so nobody goes hungry before the first harvest; there is no other grace. The overview chip (😊 62%) opens
  **👪 Families**: homes, families, approval and its breakdown, yesterday's meal, firewood, ale and clothes, and when the
  next family comes ("Build a cottage to house another family"); the 👨‍🌾 Farmers sheet shows the same block. A
  cottage puffs chimney smoke on winter days while it has firewood. Arrivals and departures are toasted and listed in
  the welcome-back summary. All of it runs inside the work scheduler on game time, so ×60, ×1 and offline catch-up
  agree. Saves from before families keep every farmer they have; while there are more farmers than homes no family
  arrives (and nobody leaves just for lack of a home).
- **House gardens:** a 2×2 backyard plot the family works in its spare time: the **🥬 Vegetable Patch** (level 2,
  $20 + 2 wood) grows 1 🥕 carrot a day in spring, summer and autumn and rests in winter, the **🐓 Hen Run** (level 3,
  $30 + 3 wood) lays 1 🥚 egg a day all year (no feed: the hens live on scraps), the **🍎 Orchard** (level 4, $40 +
  3 wood) gives 4 🍎 apples a day in autumn. A garden must touch a home (the farmhouse or a cottage) along an edge, and
  each home has at most one; the build ghost outlines the homes still free for one and is red elsewhere ("A garden
  must touch a home along an edge", "That home already has a garden"). It needs no farmer and no path and is laid out
  at once. A day after it is built, and every day after, its yield goes into the granary; what doesn't fit waits in
  the garden and goes in as soon as there is room, so nothing is lost. A garden whose home is demolished stops (it
  takes up another free home beside it, should one be built). Each feeds about half a family at most (a family eats
  2 a day). Yields are work-scheduler events, so ×60, ×1 and offline catch-up agree. Tapping a garden shows what it
  makes, this season's yield, what waits and the next yield; the cottage and farmhouse panels name their garden, or
  "No garden yet". **🍎 Apple** is a new food (a crop, sells for $7). Goals "Plant a vegetable patch" and "Gather 20
  apples" come last.
- **Farmhouse and roads:** every farm has a farmhouse (it can't be built or demolished). Idle farmers rest on its bench;
  for a job a farmer walks out of the door **along paths** to the work (0.4 game-s per tile), works there (hoeing,
  sowing, harvesting, hammering, feeding) and walks back, busy the whole way. On the way they carry what the job moves:
  a sack home from a harvest or a workshop and out to feed, spread manure or load a batch, a basket of eggs, a bucket
  of milk, a sack of wool, logs or stone from the lodge, quarry or mine, and logs (or stone) out to a construction
  site; ploughing, sowing and hauling trips are empty-handed (a carter's goods ride on the oxcart). It is only the look: the goods moved when the job started
  (`CARRY` in `src/scenes/art.ts`). Work on a field, pen or building is refused
  until a path joins it to the door ("No path leads there"), and the build ghost turns red where no path reaches.
  New farms start with a road from the door to both fields; older saves get a farmhouse and roads to what they built.
- **Starting camp:** a new game starts like Manor Lords: the settlers arrive with supplies, shown as a ⛺ **camp**
  (3×3: a patched tent with a campfire on the back tiles, the supply piles scattered in front) beside the farmhouse,
  next to the path, on the side away from the fields. It holds **40 🪵 wood, 20 🪨 stone, 15 🍞 bread and 15 🥕 carrots**
  (`CAMP_SUPPLIES` in `src/data/camp.ts`): enough for a granary, a cottage and a storehouse or coop, and about 5 days
  of food for the first families. They are ordinary stock: the resource bar shows them and building, meals, selling
  and orders use them as any other. The camp records what is `left` of each; after every change to the stock
  `left = min(left, stock)`, so whatever is spent, sold or eaten comes out of the camp first and new harvests,
  purchases or lodge wood never refill it (`src/logic/camp.ts`). Orders don't learn goods from the camp's supplies.
  Tapping the camp shows "Starting supplies: 32 🪵 · 20 🪨 · 12 🍞 · 15 🥕 left". It isn't in the build menu and
  can't be demolished or built over. Once every supply is used up the tent fades away, a toast says "Your camp is
  packed away: the starting supplies are used up", and its tiles are free to build on. Campfire smoke rises on winter
  days. Saves from before the camp have none and keep their stock.
- **Seasons:** a game day lasts 8 real minutes at ×1 and each season 4 days, about 30 minutes (days 1–4 spring,
  5–8 summer, 9–12 autumn, 13–16 winter, then round again), so a year takes about 2 hours. The pace is slow on
  purpose: a new player reaches level 2 in 10–15 minutes and level 5 in 2–3 hours (level 5 asks for 5,000 XP: families eat
  part of what the farm makes). The HUD shows the season next to
  the day (bottom right) and a toast announces each new one. A field must be **ploughed** ($5) before sowing.
  Ploughing works in spring, summer and autumn, and the soil stays ploughed through harvests until the winter frost,
  which turns every empty field back to unploughed (faded soil); in winter nothing can be ploughed or sown.
  Each crop is sown only in its seasons (see **Crops** above), and only while it will be ripe before they end. A ripe
  crop keeps in the field, even into winter. **Cabbage** is the winter crop: its seasons are autumn and winter, so it is
  sown in autumn (only while it can ripen before winter ends) and ripens in winter. The frost only unploughs empty
  fields, so a cabbage field stands through it (drawn with frost and snow) and is harvested in winter, by hand or by its
  farmer.
  The new farm's two starting fields come ploughed.
- **Seasonal look:** the farm looks like its season. Spring is bright green with flowers and blossoming trees, summer a
  deep warm green with dry patches, autumn ochre grass, fallen leaves and orange, red and yellow trees, winter snow on
  the ground, paths, roofs and rocks, bare snowy trees, frozen fields and frozen ponds (a few small ponds lie on the
  locked land as scenery). Small decorations lie over the grass, in clusters (about one tile in four): grass tufts and
  stones all year, with daisies, buttercups, cornflowers and a puddle in spring, tall grass and poppies in summer,
  mushrooms and fallen leaves in autumn, and twigs and dry grass through the snow and snow drifts in winter. Forest
  edges have undergrowth on the free tiles one or two tiles out: ferns (brown in autumn), fallen logs and bushes, all
  snowy in winter. They are purely decorative (scattered from a fixed seed, not saved): never in the way of building or
  walking, not clickable, hidden under whatever is built on a tile and back when it is demolished; the meadow ones
  show on the farm's own land, so buying land brings its decorations. On top: a subtle colour grade and background on the farm camera (cooler in winter, warmer
  in autumn; the HTML HUD is untouched) and weather particles in screen space (snowfall in winter, drifting leaves
  in autumn, a few petals in spring, clear summers), at most 150 and thinner when zoomed out. The look follows the
  game clock: at once on load, New game, debug **Next season** and after time away, with a 1.5 s crossfade when the
  season comes round while playing. ⚙️ Menu → Settings → **Weather effects** turns the particles off (localStorage
  `farmer.weather`); it starts off when the system asks for reduced motion.
- **Hazards (events and defences):** from the farm's second season, things go wrong, Manor Lords style, and each has a
  defence. They are decided from a seed saved with the farm and the game clock, inside the work scheduler, so ×1, ×60,
  reloads and offline catch-up give the same farm. Rules in `src/logic/hazards.ts`, numbers in `src/data/hazards.ts`.

  | event | when | unprotected | defence |
  | --- | --- | --- | --- |
  | 🥶 **Harsh winter** | about 1 winter in 3, from level 3; announced at the start of autumn | homes burn 2 wood a day instead of 1 | stock wood (the warning says how much) |
  | ☀️ **Drought** | about 1 summer in 3, from level 2; announced a day ahead; lasts to the end of summer | crops grow at half speed and yield 30% less | a **🪣 Well** (1×1, $40 + 6 stone, level 2) within 4 tiles of the field |
  | 🐦‍⬛ **Crows** | on random days (30%) spring to autumn, from level 2 | a flock lands on one growing field for 2 game-minutes and eats 30% of its harvest | a **👒 Scarecrow** (1×1, $15 + 2 wood, level 2) within 3 tiles |
  | 🦊 **Fox** | on random days (25%) once the farm has chickens | takes one chicken from a coop | a **🐕 Kennel** (1×1, $60 + 6 wood, level 3) within 6 tiles of the coop |

  Fairness: nothing in a new farm's first season, at most one new event a day, losses never take money, a fox never
  takes the farm's last chicken, and a harsh winter only doubles the firewood the families need (the usual approval
  rules count the cold homes). Reach is counted edge to edge (like a woodcutter's lodge's); a defence works once
  built. A drought slows the crops growing when it starts and those sown during it; a well built later helps the next
  crop. Crops keep their progress, so a parched crop never shrinks back a stage. Every warning, loss and defence is a
  toast; **📖 Almanac** in the tool bar (a banner under the level while one is announced or on) lists what is on now, what is coming (announced events, and crows or a fox about
  today), every threat with its defence and the recent losses; the welcome-back summary lists what happened while you
  were away. A parched field is drawn dry and cracked, crows peck on the field they eat, and a harsh winter snows
  heavier (still at most 150 particles). Field and coop panels say "🛡️ Protected by …" or "⚠️ Unprotected: build …";
  the build ghost of a well, scarecrow or kennel shades the tiles it reaches and counts the fields or coops it guards.
  Two goals near the end of the list, before the oxcart goals: **Build a well** and **Protect a coop with a kennel**.
- **Sound:** starts on the first click/tap (browser autoplay rules). **M** mutes everything (with a toast); ⚙️ Menu → Settings has
  Music and Effects sliders, a mute switch and the audio Credits. Sound settings are kept in localStorage
  (`farmer.audio`), not in the save. Music and the ambience pause while the tab is hidden.
- **Perks:** every level-up from level 2 to 10 offers **3 perks** as cards in the "Level N!" dialog; pick one and it
  lasts for good. **Decide later** (or Esc) keeps the choice open: a ⭐ banner under the level (and ⭐ Perks → Choose a perk) reopens it, and several
  open choices stack, oldest first. The cards are buttons (Tab or the arrow keys, Enter). The offer is fixed by the
  level and a seed saved with the farm, so a reload never rerolls it; it never repeats a perk already taken, and
  Husbandry, Quick hands and Prospector only turn up once the farm has a pen, a processing building or a resource
  building. The pool (`src/data/perks.ts`): Green thumb (harvests +15%), Good boots (farmers walk 25% faster), Haggler
  (the Market pays 10% more for goods, not materials, and never as much as it charges), Husbandry (animals produce 20%
  faster), Master builder (building work 30% faster), Big barns (granaries and storehouses hold 20% more), Thrifty
  (buildings need 20% fewer materials, rounded up, at least 1), Warm hearths (half the winter firewood), Good neighbours
  (approval +10, its own line in the breakdown, from the next day), Rich soil (harvests drain the soil 30% less),
  Prospector (lodges, quarries and mines yield 25% more, rounded up) and Quick hands (processing batches 20% faster).
  Each is read through `perkFactor(state, id)` (`src/logic/perks.ts`) at one place in the rules, so live play, ×60 and
  the offline catch-up agree. The perks taken are listed in the **⭐ Perks** tab of the Development window (click the level), with a button for
  the open choices. A save from before perks gets one open choice per level it has already reached.

### Debug mode (QA)

Open `/?debug=1` for a panel with **+$1000**, **+10 of any item**, clock speed **×1 / ×10 / ×60 / ×300**
(at ×60 a season passes in 32 real seconds, at ×300 in under 7 and a whole year in under half a minute),
**Next season** (jumps the clock to the start of the next season, like time away but without the summary),
**+1 family** (fills an empty home at once), **Next day** (jumps to the next day boundary, where the families settle
their needs), **Drought now** (a drought until the end of the current season), **Crows now** (a flock lands on a
growing field now), **Fox now** (a fox comes to a coop now), **Harsh winter next** (the coming winter, or this one, is
harsh, with its warning), **Refresh orders** (fills every order slot now), **Regrow all trees** (every stump grows back
at once), **Reset perks** (forgets every perk taken; every level reached gets its choice back), **Trader now** (a trader
parks by the farmhouse at once, whatever the level and schedule, and leaves at the end of the day) and **Clear market
drops** (every flooded price back to the day's price). Setting a higher level opens a choice for each level on the way.
The hazard buttons skip the rolls, the level and the season, but defences still work and a fox still never takes the
last chicken; when nothing can happen (no growing field, fewer than 2 chickens) a toast says why. **+10** adds only
what the granaries or storehouses have room for. **Next day** and **Next season** are not time away: a trader due on
the way arrives as in play.
`window.farm` always returns a frozen, read-only snapshot of the game state (plus `day`), e.g.
`window.farm.money`, `window.farm.inventory`, `window.farm.objects`. `window.farm.orders` holds the
orders board: `known` goods and `slots[i]` (`order: { customer, items: [{ itemId, qty }], reward }` or
`refill: { start, duration }` with `reason: 'fulfilled' | 'discarded'`).
`window.farm.market` is, per priced item, `{ price, drop }`: what one unit fetches now and how far it is down from the
day's price (0 to 0.5). `window.farm.trader` is `{ here, arrivesAt, leavesAt, wants: [{ item, price, left }], sells:
[{ item | animal, price, left }] }`: `arrivesAt` and `leavesAt` are game times (`window.farm.clock.elapsed`) of the
trader here, else of the next one due (null below level 3); `wants` and `sells` are empty while none is here. The saved
state is `window.farm.ext.trader` (with `visit.tile`, where the wagon stands) and `window.farm.ext.market`.
`window.farm.lastCatchUp.traders.missed` counts traders that came while the player was away.
`window.farm.iso.tileToScreen(x, y)` returns the page pixel of tile (x, y)'s centre at the current camera, so a
script can click a known tile (`page.mouse.click(p.x, p.y)`). Browsers report mouse positions in whole CSS pixels,
so to click "just inside" an edge, stay at least 2 px inside it.
`window.farm.camp` is `{ id, left, room, packed }`: the camp's object id, what is left of each supply, the room it adds
to each pool (`{ goods, materials }`) and whether it is packed away (then `left` is empty and the object is gone); null
on saves from before the camp. Its object is type `camp` in `window.farm.objects`, its slice `window.farm.ext.camp`
(`{ id, packed }`). The camp panel's lines have test ids `camp-supplies` and `camp-note`.
`window.farm.storage` is `{ goods: { used, capacity }, materials: { used, capacity } }`; each storage building's
level is `state.level` of its entry in `window.farm.objects` (type `granary` or `storehouse`). A `woodcutter`, `quarry`
or `mine` entry has `state: { cycle, waiting, day, today }`: the cycle being worked (`{ start, duration }` or null),
the output in its yard, and what was made on `day`. An `oxbarn` entry has `state: { ox, cargo }` (cargo: goods left
on the parked cart). `window.farm.carts` lists every barn with an ox as `{ barn, farmer, leg, at, load, from, to }`:
`leg` is `'parked'`, `'walk'` (the carter walks to the barn or home), `'drive'`, `'load'` or `'unload'`, `at` the
cart's grid point, `load` the goods on the cart, `from` / `to` the pickup and store ids of the trip (null while
parked). A carter's job in `window.farm.ext.workers.jobs` has kind `haul` and a `haul` trip with its legs. Debug
mode adds **🐞 Free ox (debug)** to a barn's panel.
`window.farm.map` is `{ trees: { grown, stumps }, species, deposits, treeAt(x, y), treeList(), sprites, pondWillows }`:
`deposits` lists every stone outcrop and iron vein as `{ kind: 'stone' | 'iron', x, y, w, h, left, amount }`;
`treeAt(x, y)` is null or `{ x, y, species, stage, status: 'grown' | 'stump', felledAt, regrowsAt }` (a tree a lodge is
felling is grown with a `felledAt` in the future) and `treeList()` gives that for every tree tile. `species` is one of
`oak`, `pine`, `apple`, `birch`, `beech`, `spruce`, `willow` (looks only: every species gives the same wood), and
`species` at the top counts the tree tiles of each. `stage` is `stump`, `sapling` (from a third of the regrow time),
`young` (from two thirds) or `grown`; anything short of grown has status `stump`, so a lodge fells only grown trees.
`sprites` counts the tree and deposit sprites drawn, and `pondWillows` the decorative willows beside ponds (not trees of
the map: never felled or saved, gone when the land is bought). The saved layer is `window.farm.ext.map`.
`window.farm.ground` is `{ counts, at(x, y) }`, the ground as drawn now (`src/scenes/ground.ts`; nothing saved):
`counts` maps each ground tile (season left off, e.g. `grass_0`, `grass_clover`, `forest_1`, `wet_0`) and each zone
(`meadow`, `forest`, `wet`) to its number of tiles; `at(x, y)` is null off the map or `{ art, tint, zone, locked }`:
`art` the frame drawn (e.g. `grass_flowers_summer`), `tint` the multiply it is drawn with (`0xRRGGBB` as a number:
colour patches × soil × zone shade × locked), `zone` `'meadow' | 'forest' | 'wet'` (forest within 1 tile of a tree
or stump, wet within 2 tiles of a pond drawn on locked land) and `locked` whether the land is not yet bought.
`window.farm.stockpiles` is `{ buildings, sprites }`: `buildings` lists every storing building (farmhouse, finished
granaries and storehouses) in placement order as `{ id, type, pools, piles, drawn }`, where `pools[pool]` is
`{ held, capacity }` (its share of the pool's stock), `piles` maps each pile (`crops`, `animal`, `feed`, `goods`, `wood`,
`stone`, `iron`, `house_goods`, `house_materials`) to its stage 0–4, and `drawn` lists the pile sprites shown (e.g.
`pile_wood_3`); `sprites` counts the pile images in the scene (fixed per building, hidden when empty). The resource bar's
chips are `data-testid="resource-<category>"` (`crops`, `animal`, `feed`, `goods`, `materials`) with `data-count` (and
`data-delta` while a change shows); the pools are `resources-pool-goods` / `resources-pool-materials` (`data-used`,
`data-capacity`, class `storage-ok|warn|full`), the popover `resources-popover` with rows `resources-item-<id>`.
`window.farm.fringes` is `{ count, at(x, y) }`: `count` is the number of grass fringe strips drawn (one per fringed
edge), `at(x, y)` the fringed edges of tile (x, y) as names, e.g. `['ne', 'sw']` (`ne` = toward -y, `se` = +x, `sw` = +y,
`nw` = -x), empty where there are none. A path or field tile is fringed on every edge whose neighbour is open grass (no
object on it, inside the map): none between two paths, between a path and a field, inside a field, along buildings,
pens and pastures.
`window.farm.decor` is `{ count, bySeason, at(x, y) }`: `count` is the ground decorations showing now (tufts, flowers
and the rest on owned land, undergrowth along forest edges), `bySeason[season]` maps each sprite to how many of the
showing decorations would be it in that season (e.g. `bySeason.spring.decor_daisies`), and `at(x, y)` is the sprite
drawn on tile (x, y) now (e.g. `decor_tuft_0_winter`, `fern_1_autumn`) or null (none, or the tile is built on).
`window.farm.season` is `{ season, dayOfSeason, msLeft, look, weather }` (e.g. `season: 'winter'`, game ms until the
next season); `look` is the season the farm is drawn in (it follows `season`, a crossfade at most behind) and
`weather` the number of weather particles alive now (0 in summer or with weather effects off, never over 150).
`window.farm.families` is `{ homes, families, approval, breakdown, lastDay, nextArrivalAt }`: `breakdown` lists
`{ id, label, points }` parts (`base`, `variety`, `food`, `clothes`, `ale`, `firewood`, `gardens`, `neighbours`), `lastDay` is
`{ ate, variety, firewood, clothed, ale }` for the last settled day (`ate`: food id → eaten; `firewood`: wood burned, null
outside winter; `clothed`: `{ families, clothes, cloth }`, the families clothed this year and how many of them wear the
tailor's clothes and plain cloth, null before the loom is unlocked; `ale`: `{ families, drunk }`, the families who had
ale that day and the ale drunk, null before the brewery is unlocked) or null before the first day, and
`nextArrivalAt` is the game time (`window.farm.clock.elapsed`) the next family is due, null while no home is free.
`window.farm.gardens` lists every house garden as `{ id, kind, home, waiting, nextAt }`: `kind` is `veg-patch`,
`hen-run` or `orchard`, `home` the id of the farmhouse or cottage it belongs to (null without one), `waiting` the
yield waiting for room in the granary, `nextAt` the game time of its next daily yield (null while it has no finished
home).
`window.farm.workers` is `{ farmers, free, list, assignments, plans, recipes, sites }`: `list[i]` is
`{ farmer, workplace, job, carrying, activity, tool }` (workplace: object id or null; job: the running job's kind or null;
carrying: what they carry now, `sack`, `basket`, `bucket`, `logs` or `stone`, or null while working, resting or walking
empty-handed; activity: the text the Farmers sheet shows; tool: the jobs left in their tools, or null without any), `assignments` maps workplace id → farmer, `plans` field id → crop plan
(`best`, `none` for Fallow, or a crop id), `recipes` building id → "Keep making" recipe, and `sites` lists the construction sites
oldest first (`{ id, type, x, y, workMs, paid, builder: { farmer, progress } | null }`). A placed object that is still a
site carries `site: { workMs, paid }` in `window.farm.objects`.
`window.farm.tools` is `{ inStore, equipped, usesPerTool, factor }`: tools in the storehouse, farmers with tools, the
jobs a set lasts (30) and the speed-up it gives (1.25). Test ids: `farmers-tools` (the sheet's tools line),
`farmer-tool-<i>`.
`window.farm.soil` is `{ at(x, y), band(x, y), quality, overlay }`: `at` gives a tile's soil quality (95 rich, 70
normal, 45 poor), `overlay` whether the Soil overlay is on. Each field in `window.farm.objects` carries
`state.fertility` (points when it began resting, or while a crop grows), `state.restingSince` (game ms, null while a
crop grows) and `state.lastCrop`; the field panel shows the current fertility (`panel-meter-fertility`), and the
construction menu's checkbox is `build-toggle-soil` (`checked`).
`window.farm.hazards` is `{ seed, current, upcoming, log, coverage(x, y), crows, guarded }`: `current` and `upcoming`
list events as `{ kind: 'harsh-winter' | 'drought' | 'crows' | 'fox', start, end, announcedAt?, target? }` (game ms;
crows eating name their field in `target`), `log` the last 30 notes newest first as
`{ at, kind, outcome: 'warning' | 'started' | 'loss' | 'defended' | 'ended', text, target?, lost? }`, `coverage(x, y)`
the defences reaching a tile (e.g. `['well', 'scarecrow']`), `crows` the crow sprites on the map and `guarded` maps
`well`, `scarecrow` and `kennel` to the ids of the fields or coops they guard. A field hit by a drought or crows carries
`state.parched` / `state.pecked` until it is harvested. The saved slice is `window.farm.ext.hazards`.
`window.farm.perks` is `{ taken, pending, offer(level) }`: `taken` lists `{ level, id }` of the perks taken,
`pending` the levels whose choice is still open (oldest first) and `offer(level)` the ids of that level's cards. Test
ids: `levelup-dialog`, `perk-card-<id>`, `perk-later`, `levelup-ok`, `banner-perk`, `perks-section`, `perk-<id>`,
`perks-choose`, `debug-reset-perks`.
`window.farm.hud` is `{ window, tab, sheet, build: { open, category }, speed, paused, banners }`: the window open
(`development`, `farm`, `trade`, `almanac` or null) and its tab, the sheet shown (a tab's sheet id, `action` for an
object's panel), the construction menu and its category, the clock speed, the player's pause (⏸) and the ids of the
banners showing. HUD test ids: `btn-paths`, `btn-build`, `btn-farm`, `btn-trade`, `btn-almanac`, `btn-menu`,
`btn-level`, `btn-season`, `btn-demolish` (🧹 in the construction menu), `build-menu`, `build-cat-<category>`
(`resources`, `storage`, `homes`, `farming`, `crafts`), `build-<type>` (cards; `data-locked` with the level while
locked, `aria-disabled` while locked or unaffordable, `build-cost-<type>`, `build-needs-<type>`), `build-toggle-soil`,
`tab-<id>` (`goals`, `perks`, `families`, `farmers`, `storage`, `market`, `orders`, `trader`, `almanac`),
`badge-<tab id>` and `badge-<window>` (`badge-development`, `badge-farm`, `badge-trade`, `badge-almanac`),
`stat-<id>` (`free`, `working`, `homes`, `approval`, `livestock`, `supplies`; `data-value`), `banner-<id>` (`perk`,
`trader`, `hazard`; class `banner-info|warn|alert`), `events-log` (🕮) with `events-pop` / `events-list`,
`speed-pause`, `speed-1`, `speed-4`, `speed-12` (`aria-pressed`), `hud-tip`, `panel`, `panel-title`, `panel-tabs`,
`panel-close`, `btn-cancel-tool`, `hud-level`, `hud-xp`, `hud-money`, `hud-day`, `hud-season`.
`window.farm.audio` is `{ muted, musicVolume, sfxVolume, lastPlayed }`, where `lastPlayed` lists the last 20 sound
keys played (e.g. `plant`, `coins`, `levelup`, `cluck`), so you can check which sounds fire without hearing them.

## Folder layout

```
src/
  main.ts            Wires everything: load save, HUD, Phaser game, autosave, window.farm
  logic/             Plain TypeScript, no Phaser (lint-enforced), unit-tested
    types.ts           GameState and friends
    game.ts            Game: the single owner of the state + typed events
    economy.ts         canAfford / spend / earn (money never goes negative)
    inventory.ts       add / remove / count (counts never go negative)
    land.ts            land ownership grid
    placement.ts       canPlace / objectAt
    clock.ts           game clock, Day N, game-time timers
    seasons.ts         seasons from the game clock (2 days each), season runs for ploughing and sowing windows
    market.ts          daily sell prices (base × 0.8–1.2 by day + item id), saturation (drops), sell / sellAll; material buy prices, buy
    trader.ts          travelling traders: the seeded schedule, offers, parking by the farmhouse door, trading
    parcels.ts         land parcels, adjacency, parcel prices ($1,000, ×1.25), buyParcel
    save.ts            versioned save/load + migrations + defaults
    slots.ts           manual save slots, strict import validation
    slices.ts          feature-owned global state (GameState.ext)
    crops.ts           ploughing, planting (in season), growth stages, harvest, fertility and manure, starting fields
    soil.ts            the soil-quality layer (fixed seed), fertility recovery, yield and drain
    families.ts        families: homes, daily meals / firewood / ale / clothes, approval, arrivals and departures (slice `families`)
    perks.ts           perks: perkFactor, seeded offers, choices and the slice `perks`; the Perks class on Game
    workers.ts         farmers: adding and removing them, jobs that keep a farmer busy, workplaces, crop plans, recipes, tool slots (state slice `workers`)
    tools.ts           farmers' tools: taking a set at job start, the speed-up (`toolFactor`), wear and breaking, the blacksmith's stop
    work.ts            the work scheduler: assigned farmers work their workplace, free ones build sites; steps on game time
    roads.ts           the farmhouse and paths: the route a farmer walks to a site; farmhouse for new and old farms
    orders.ts          orders board: known goods, seeded order generation, rewards, fulfil/discard, refill timers
    storage.ts         goods/materials pools: capacity, used, spaceFor (Game.addItem takes only what fits), upgrades
    camp.ts            the starting camp: where it goes, what is left (trimmed after every removeItem), its room, packing away (slice `camp`)
    resources.ts       woodcutter, quarry, mine: production cycles, the yard (3 cycles' yield), idle reasons
    haul.ts            ox barns and oxcarts: buying the ox, planning a trip (fullest pickup, nearest store), the legs
                       and their timing, loading / unloading / parking as scheduler events, `cartsOf`
    maplayer.ts        the map layer: forests (felled time, lazy regrowth) and deposits (what is left), seeded
                       generation for new games and old saves, the placement rule for trees and deposits
    stockpiles.ts      which stock pile stage each storing building shows (the shared pools split in placement order)
  data/              Content as data
    items.ts           item catalogue (ids shared by every feature)
    materials.ts       building materials (wood, stone, iron): ids, the level the Market sells each from, cost text
    storage.ts         granary and storehouse buildables, levels and capacities, the farmhouse store
    camp.ts            the starting camp buildable (3×3, fixed) and its supplies
    families.ts        the Cottage buildable, foods, needs per family, approval points, arrival and leaving thresholds
    perks.ts           the perk pool: name, what it does, its factor and what it is about
    tools.ts           tools: jobs a set lasts, the speed-up, the jobs they work on
    resourceBuildings.ts woodcutter's lodge, quarry and mine buildables: costs, yields, cycle times
    haul.ts            the Ox Barn buildable, the ox price, cart capacity, ox speed, load times, yard size
    resources.ts       resource categories (resource bar, stock piles), item → category / pile
    buildables.ts      build menu registry (+ the core Path)
    crops.ts           crop catalogue (with each crop's seasons) + the Field buildable
    seasons.ts         season names, icons, length, ploughing seasons and cost
    customers.ts       customer names for orders
  game/              Glue between logic, scene and UI
    context.ts         FarmContext, PanelSpec, ToolState
    hooks.ts           registerBehavior / registerHudButton / registerHotkey / onGameStart / registerSettingsSection / registerDebugInfo
    signals.ts         uiSignals: UI moments that are not state changes (refused action, welcome-back opened)
  scenes/            Phaser scenes
    iso.ts             isometric projection (no Phaser, unit-tested): ISO_W/ISO_H, tile ↔ world, picking, depth order
    depth.ts           depth layers (ground, flat, shadow, tall, signs, ghost…)
    art.ts             the art pack (no Phaser, unit-tested): texture key → pack sprite, path/fence autotile
    decor.ts           ground decorations and forest-edge undergrowth: the seeded, clustered scatter (no Phaser, unit-tested)
    sprites.ts         drawing pack sprites (anchors, 2x art at half scale, shadows)
    textures.ts        the few runtime-drawn textures (bubbles, sparkles, smoke, `missing`)
    BootScene.ts       loads the pack (progress bar), anchors, animations, composed textures
    FarmScene.ts       ground (one Blitter), scenery, objects, camera, build/demolish input
  ui/                HTML/CSS overlay above the canvas
    hud.ts             the HUD zones (overview, level and banners, money, season and speed, tool bar), windows
                       with tabs and the action panel in one sheet, hotkeys and Esc, toasts and recent events, dialogs
    buildmenu.ts       the construction menu: category icons, picture cards, checkboxes
    tip.ts             the HUD's hover / tap tooltip
    resources.ts       the resource bar at the top right: category chips, +N/−N flashes, popover, pool room
    debug.ts           ?debug=1 panel
    menu.ts            home screen and pause menu: save / load / export / import, settings
  features/          One folder per feature, auto-loaded (see below)
    path/              reference feature
    animals/           coops, pastures, wandering animals (data: src/data/animals.ts, logic: src/logic/animals.ts)
    processing/        feed mill, dairy, bakery, loom, blacksmith, malthouse, brewery, tailor (data: src/data/processing.ts, logic: src/logic/processing.ts)
    fields/            field + crop views, ripe effects, plough/plant/harvest panel
    soil/              the Soil overlay and its construction-menu checkbox, the field ghost's soil tint, the field panel's
                       soil block and Spread manure action, `window.farm.soil` (data: src/data/soil.ts)
    decor/             the ground decorations as one Blitter under everything placed, `window.farm.decor`
    seasons/           season-change toasts, the seasonal look (art swap, colour grade, crossfade), weather
                       particles and their setting, `window.farm.season`
    market/            🏪 Market tab (⚖️ Trade): sell panel (flooded marks, confirm before flooding) and Buy section
    trader/            🛒 travelling trader: the wagon by the farmhouse, his banner and ⚖️ Trade tab (logic: src/logic/trader.ts)
    storage/           granary and storehouse: art per level, level badge, storage panel with Upgrade, the 📦 Storage tab,
                       `window.farm.storage`, the one-time notice for old saves; stock piles in the yards
                       (piles.ts, `window.farm.stockpiles`)
    resources/         woodcutter's lodge, quarry, mine: work chips/dust, the yard's pile, panel
    haul/              ox barn panel (buy an ox, wait reasons), the oxcarts on the map, `window.farm.carts`
    nature/            trees (species and look per tile: species.ts), stumps, saplings, outcrops and veins on the
                       map; the lodge's reach on the build ghost; `window.farm.map`
                       (data: src/data/resourceBuildings.ts, logic: src/logic/resources.ts)
    orders/            📋 Orders tab (⚖️ Trade, with badge) and orders panel
    camp/              ⛺ the starting camp: tent panel, winter campfire smoke, fade and toast when packed away, `window.farm.camp`
                       (data: src/data/camp.ts, logic: src/logic/camp.ts; its piles are drawn by storage/piles.ts)
    families/          🏠 home room, 😊 approval and 🧺 supplies chips, the 👪 Families tab, cottage smoke and panel, arrival/departure toasts,
                       `window.farm.families` (data: src/data/families.ts, logic: src/logic/families.ts)
    gardens/           vegetable patch, hen run (two hens) and orchard (two apple trees): panel, the free homes
                       outlined on the build ghost, the garden line of home panels, `window.farm.gardens`
                       (data: src/data/gardens.ts, logic: src/logic/gardens.ts)
    workers/           free / working farmer chips, the 👨‍🌾 Farmers tab (workplace sheet (with the tools and the families block), farmers at work on the map,
                       the worn-out tools toast, `window.farm.workers`, `window.farm.tools`
                       (data: src/data/workers.ts, logic: src/logic/workers.ts and work.ts; hand work goes through
                       `withFarmer`, workplace panels get their farmer block from `workplacePanel`, src/game/workers.ts)
    land/              "For sale" signs on parcels next to owned land, buy dialog
    audio/             effects, animal voices, ambience, music; mute button, sound settings, credits
                       (files: public/audio/*.mp3, licences: CREDITS.md)
```

## Extending the game

Features live in `src/features/<name>/index.ts`. Every such file is imported automatically
(`import.meta.glob` in `src/features/index.ts`), and registers what it needs as a side effect.
**A new feature should not need to edit any shared file**, so parallel work rarely conflicts.

### Add an item

Items are shared ids, so they live in one place: add an entry to `ITEMS` in `src/data/items.ts`
(`id`, `name`, `category`, base sell `price`, emoji `icon`). Use the id everywhere else; give it a pack icon
in `public/assets/farm/*/icons/<id>.png` and list it in `ICON_ART` (`src/scenes/art.ts`), and its emoji in any
label shows as that icon
(`game.addItem('egg', 3)`, `game.count('milk')`).

### Add a buildable

```ts
// src/features/coop/index.ts
import { registerBuildable } from '../../data/buildables';
import { registerBehavior } from '../../game/hooks';
import { startTimer, timerDone, timerProgress, type Timer } from '../../logic/clock';

interface CoopState { hens: number; timer: Timer | null }

// `texture` is a sprite of the art pack (public/assets/farm/manifest.json), or a game key mapped to one in
// TEXTURE_ART (src/scenes/art.ts). It is drawn anchored on the footprint's top corner, with its shadow.
registerBuildable({
  id: 'coop',
  name: 'Chicken coop',
  cost: 100, // money
  materials: { wood: 8 }, // optional: { wood?, stone?, iron? }, bought at the Market; omit for money-only
  footprint: { w: 3, h: 3 }, // the sprite's footprint in the manifest
  texture: 'chicken_coop',
  category: 'animals',
  initialState: (): CoopState => ({ hens: 0, timer: null }), // also fills old saves
});

registerBehavior<CoopState>('coop', {
  create(ctx, obj, view) { /* add sprites to view.container */ },
  update(ctx, obj, view, gameDt) { /* animate; runs every frame */ },
  refresh(ctx, obj, view) { /* obj.state changed: update the view */ },
  panel: (ctx, obj) => ({
    title: 'Chicken coop',
    icon: '🐔',
    lines: [`Hens: ${obj.state.hens}`],
    progress: obj.state.timer ? { value: timerProgress(ctx.game.state.clock, obj.state.timer) } : undefined,
    actions: [
      {
        label: 'Collect eggs',
        disabled: !obj.state.timer || !timerDone(ctx.game.state.clock, obj.state.timer),
        onClick: () => {
          ctx.game.addItem('egg', obj.state.hens);
          obj.state.timer = startTimer(ctx.game.state.clock, 60_000);
          ctx.game.touch(obj); // announce the state change
          ctx.ui.floatText(obj.x, obj.y, `+${obj.state.hens} 🥚`);
        },
      },
    ],
  }),
});
```

The build menu (with money and material costs), ghost preview, placement rules, charging money and
materials (`game.place` refuses with reason `money` or `materials` and changes nothing), construction sites, demolish
refunds (half of both; everything for an unfinished site), saving and the action panel all come for free. Keep money +
materials at their usual buy prices (about $6 wood, $7 stone, $22 iron) in line with the level curve
(`src/logic/balance.test.ts`). A "Demolish" action is appended to every object panel. Placed from the build menu, it is
a construction site (`obj.site`) until a farmer has built it: no `onClick` and no `panel` run for it until then.

### Add a workplace

A buildable becomes a workplace (a farmer can be assigned; the panel gets the farmer block) by adding its type to
`isWorkplaceType` in `src/logic/workers.ts`, and its automatic work by a case in `workplaceNext` (`src/logic/work.ts`):
return `{ task: { kind, workMs, run } }` when there is a job (`run(walkMs)` does it now, as a tap would, and returns
whether it did; `walkMs` is the farmer's walk there, for work that starts on arrival like a resource cycle) or `{ wait: reason }` when there is none. If its work can appear when a timer ends, add that end time in
`nextWorkEvent`, so the scheduler (and offline catch-up) wakes up then. Game time only: never frames or `Date.now()`.

### Add a timer

Never use `setTimeout`, `setInterval` or `Date.now()` for gameplay. Store a `Timer`
(`startTimer(clock, durationMs)`) in the object's state and read it with `timerProgress`,
`timerRemaining` and `timerDone`. Timers run on game time, so they survive save/load and
speed up with the debug clock speed. `game.now` is the current game time in ms;
1 day = 8 real minutes at ×1 (`DAY_MS`), 1 season = 4 days (`SEASON_DAYS`). Subscribe to `game.events.on('day', ...)`
for daily events. Keep durations in the data files (`src/data/*`, `src/logic/constants.ts`) and check the level
curve with `src/logic/balance.test.ts` after changing them. Time away is caught up when the game opens again
(`src/logic/offline.ts`, at ×1, up to `MAX_OFFLINE_MS`): timers simply end, and farmers do their work on the way.
Use `game.advance(ms)` to move time in tests (it runs the work scheduler); setting `clock.elapsed` directly skips the farmers.

### Other extension points

- **HUD button:** a feature places itself in the HUD with `registerHudButton({ id, label, icon, spot, badge?, live?, visible? })`;
  `src/ui/hud.ts` lists no features. The `spot` says where:
  - a **window tab**: `{ kind: 'tab', window: 'development' | 'farm' | 'trade' | 'almanac', order, sheet: (ctx) => SheetSpec }`
    (e.g. the Market). Its `badge` also counts on the window's button.
  - a **farm overview chip**: `{ kind: 'chip', order, opens: '<tab id>', detail: (ctx) => lines }`; `live` gives its
    icon and number, `label` explains it (e.g. supplies).
  - a **banner** under the level: `{ kind: 'banner', order, opens: '<tab id>', severity: (ctx) => 'info' | 'warn' | 'alert' }`;
    `live` gives its text, `visible` when it shows (e.g. the trader).

  `badge: (ctx) => n` shows a count (hidden at 0), `visible: (ctx) => bool` shows it only at times. Ids are unique per
  kind of spot. `ctx.ui.openTab(id)` opens a tab from anywhere (the trader's wagon does). A **hotkey**:
  `registerHotkey({ key: 'm', label, run: (ctx) => ... })` (blocked while a dialog or the menu is open). A
  **construction menu checkbox**: `registerBuildMenuToggle({ id, label, icon, isOn, toggle })` (the 🌱 Soil overlay). A
  new building goes in the menu's tab named by its `category` (`BUILD_CATEGORIES` in `src/data/buildables.ts`).
- **Global feature state** (e.g. market prices): `registerStateSlice('market', () => ({ ... }))`
  and `getSlice(game.state, 'market')`. Defaults are merged into old saves. A slice that saves tile coordinates passes
  a third argument, `(saved, dx, dy) => moved`, so save migrations that move the farm on the map move them too.
- **Custom sheet** (markup of your own, like the Market): `ctx.ui.toggleSheet({ id, title, signature, render, tick })`.
- **Confirm dialog:** `await ctx.ui.confirm(title, message, { confirmLabel, variant, disabled, hint })`.
- **Taps on empty tiles** (e.g. locked land): `registerTileTapHandler((ctx, x, y) => true /* handled */)`.
- **Panel drop-downs:** a `PanelSpec` may have `choices: [{ id, label, value, options, onChange }]`, rendered as
  `<select data-testid="panel-choice-<id>">` above the actions (e.g. the crop plan).
- **Work that needs a farmer:** wrap it in `withFarmer(ctx, kind, obj, durationMs, () => didIt)` from
  `src/game/workers.ts`; it refuses with a toast when every farmer is busy or no path leads from the farmhouse to the
  site, and sends a farmer along the path only if the action succeeded.
- **Selling:** `sell(game, itemId, qty?)` / `currentPrice(game.state, itemId)` (today's price with the farm's perks,
  less its saturation drop; `farmSellPrice` is it before the drop, `dailyPrice` the plain one) / `quoteSale(game.state,
  itemId, qty)` from `src/logic/market.ts`.
- **Perks:** add one to `PERKS` in `src/data/perks.ts` (its `value` and `neutral`, and `subjects` if it is about a kind
  of building) and read it with `perkFactor(state, id)` at the one place in the rules it changes.
- **Buying materials:** `buy(game, itemId, qty)` / `buyPrice(game.day, itemId)` from `src/logic/market.ts`;
  `game.missingMaterials(game.materialsFor(type))` and `game.canPayFor(type)` say whether a building can be paid for
  (`materialsFor` is the cost with the farm's perks).
- **Items coming in:** always `game.addItem(itemId, qty)`. It takes only what the storage pools have room for and
  returns how many went in; check `game.spaceFor(itemId)` first for all-or-nothing intake (like a harvest), and
  leave what didn't fit where it was (in the pen, the building, the field). Rules: `src/logic/storage.ts`.
- **Feedback:** `ctx.ui.toast(msg, 'success' | 'error')`, `ctx.ui.floatText(tileX, tileY, text)`.
  Money changes float next to the money counter automatically.
- **Events:** `game.events.on('money' | 'inventory' | 'objectAdded' | 'objectRemoved' | 'objectChanged' | 'land' | 'day' | 'speed' | 'reset', fn)`.
- **Land:** `game.setLandOwned(x, y, true)` repaints tiles and fences.
- **Startup logic:** `onGameStart((ctx) => { ... })`.
- **New-game content:** `onNewGame((state) => addStartingObject(state, 'field', x, y))` from
  `src/logic/state.ts` (runs only for brand-new farms, not loaded saves).

## Save data

Autosaved to `localStorage` (`farmer.save`) every 10 s and when the tab is hidden or closed.
Saves are versioned (`SAVE_VERSION` in `src/logic/save.ts`). Missing fields fall back to
defaults, so adding state needs no migration; restructuring does (add one to `migrations`).
The `perks` slice (seed, perks taken, open choices) is purely additive, so it needed no version bump: a save without
it gets a seed on load and one open choice per level it has reached.
Version 11 added the map layer: an older save gets one generated around what it has built (never on top of it),
with a full deposit under every quarry and mine and a grove of about 8 trees in reach of every lodge.
Version 13 added oxcart hauling: a resource building's `waiting` output (from older saves: what waited for storehouse
room) stays, now as its yard, so nothing is lost; jobs gain an optional `haul` trip and ox barns their own state.
Version 14 added tools: every farmer of an older save gets an empty tool slot (`workers.tools`).
The starting camp needed no version bump either: it is an object (type `camp`, its `left` in `state`) plus the
additive `camp` slice (`{ id, packed }`); a save without them simply has no camp.

- **Home screen:** the page opens on a "Farmer" title over the dimmed, paused farm (its seasonal look, or a fresh
  farm on a first visit): **Continue** (only with an autosave; it catches up on the time away and shows the
  welcome-back summary then, not before), **New game** (asks first when a farm exists), **Load game** and
  **Settings** (sound, weather, …). The clock does not run on the home screen and nothing is autosaved there.
- **Pause menu:** ⚙️ **Menu** in the tool bar, or **Esc** when nothing else is open (Esc still cancels a tool
  or closes a menu or window first; in the menu it goes back, then resumes). Resume, Save game, Load game, New game, Settings
  and Quit to title. The game is paused while it is open, and the hidden-tab and page-close saves keep working. Resume keeps the player's own ⏸ pause.
- **Save slots** (`src/logic/slots.ts`): 3 manual slots in `farmer.slot.1`–`farmer.slot.3`, beside the autosave,
  each showing day, season, farm level, money and when it was saved ("Empty" otherwise). **Save game** writes the
  current farm into a slot (overwriting asks first). **Load game** lists the Autosave and the slots; loading asks first,
  replaces the farm through `game.reset` and becomes the autosave from then on. A manual slot is a snapshot: it comes
  back exactly as saved, with no offline catch-up (only Continue and the Autosave row catch up). Slots can be deleted
  (with a confirmation).
- **Export / import:** **Export** downloads the current farm (Save game screen) or any slot as
  `farmer-save-<date>.json`. **Import** reads such a file into a slot; older versions migrate, while a broken or
  foreign file is refused with an error toast and nothing is overwritten.
- If browser storage is full or blocked, a save fails with an error toast and the game keeps running.
- **QA:** `/?menu=0` skips the home screen and goes straight into the autosaved farm, caught up as before (debug mode
  still shows the menu unless `?menu=0`). `window.farm.menu` is `'home' | 'paused' | null` and `window.farm.slots`
  the Load screen's summaries (`{ id: 'auto' | 1 | 2 | 3, empty, day, season, level, money, savedAt }`). Test ids:
  `menu`, `menu-continue`, `menu-new-game`, `menu-load`, `menu-save`, `menu-settings`, `menu-resume`, `menu-quit`,
  `menu-back`, `btn-menu`; rows `slot-<id>` with `slot-load-<id>`, `slot-export-<id>`, `slot-import-<n>`,
  `slot-delete-<n>`, `slot-save-<n>`, `export-current`, the file input `import-file`; confirms use `confirm-ok` /
  `confirm-cancel`.

## Art

The isometric farm pack in `public/assets/farm/` (its `README.md` and `manifest.json`; licence in
CREDITS.md). The 2x set is loaded and drawn at half scale, so one world pixel is one 1x pack pixel and a tile
is 128 × 64. `src/scenes/art.ts` maps the game's texture keys to pack sprites; anchors come from the manifest.
Only speech bubbles, sparkles and smoke are drawn at runtime. Emoji remain only where the pack has no icon
(animals, buildings, HUD buttons).

The pack is generated by Python code in [`tools/art/`](tools/art/README.md): `npm run art` rebuilds it into
`public/assets/farm/`. New crops, animals and buildings get their art there, in the same style; its README
has setup steps and a worked example.
