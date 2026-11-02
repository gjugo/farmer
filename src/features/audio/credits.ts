/** Every audio file and its licence. Mirrors CREDITS.md; non-CC0 entries are also credited in-game. */
export interface AudioCredit {
  key: string;
  title: string;
  author: string;
  url: string;
  license: string;
}

export const AUDIO_CREDITS: readonly AudioCredit[] = [
  { key: "click", title: "impactWood_light_002 (Kenney 'Impact Sounds' pack)", author: "Kenney (kenney.nl)", url: "https://kenney.nl/assets/impact-sounds", license: "CC0" },
  { key: "build", title: "impactPlank_medium_000 + impactPlank_medium_002 (Kenney 'Impact Sounds' pack)", author: "Kenney (kenney.nl)", url: "https://kenney.nl/assets/impact-sounds", license: "CC0" },
  { key: "demolish", title: "35 wooden cracks/hits/destructions - crack01", author: "qubodup (cut from independent.nu Ljudbank)", url: "https://opengameart.org/content/35-wooden-crackshitsdestructions", license: "CC0" },
  { key: "plant", title: "Shovel Sound", author: "themightyglider", url: "https://opengameart.org/content/shovel-sound", license: "CC0" },
  { key: "harvest", title: "footstep_grass_001 (Kenney 'Impact Sounds' pack) + cloth2 (Kenney 'Rpg Audio' pack)", author: "Kenney (kenney.nl)", url: "https://kenney.nl/assets/impact-sounds", license: "CC0" },
  { key: "buy_animal", title: "Correct Bell", author: "Fupi", url: "https://opengameart.org/content/correct-bell", license: "CC0" },
  { key: "feed", title: "dropLeather (Kenney 'Rpg Audio' pack) + footstep_snow_000 + footstep_snow_002 (Kenney 'Impact Sounds' pack)", author: "Kenney (kenney.nl)", url: "https://kenney.nl/assets/rpg-audio", license: "CC0" },
  { key: "collect_egg", title: "chip-lay-1 (Kenney 'Casino Audio' pack)", author: "Kenney (kenney.nl)", url: "https://kenney.nl/assets/casino-audio", license: "CC0" },
  { key: "collect_milk", title: "6 Short water splashes - water_splash-03 + Liquid Bottle Drink Set - bottle-shake-12", author: "qubodup (from pdsounds.org recordings) + qubodup", url: "https://opengameart.org/content/6-short-water-splashes", license: "CC0" },
  { key: "collect_wool", title: "Various scissors - garden_shears_01 + cloth1 (Kenney 'Rpg Audio' pack)", author: "sinny + Kenney (kenney.nl)", url: "https://opengameart.org/content/various-scissors", license: "CC0" },
  { key: "process_start", title: "metalLatch (Kenney 'Rpg Audio' pack) + impactWood_heavy_001 (Kenney 'Impact Sounds' pack)", author: "Kenney (kenney.nl)", url: "https://kenney.nl/assets/rpg-audio", license: "CC0" },
  { key: "process_done", title: "Bell dings/chimes - bell_ding3", author: "PWL", url: "https://opengameart.org/content/bell-dingschimes", license: "CC0" },
  { key: "coins", title: "handleCoins (Kenney 'Rpg Audio' pack)", author: "Kenney (kenney.nl)", url: "https://kenney.nl/assets/rpg-audio", license: "CC0" },
  { key: "order", title: "handleCoins2 (Kenney 'Rpg Audio' pack) + 100 CC0 SFX - bell_02", author: "Kenney (kenney.nl) + rubberduck", url: "https://kenney.nl/assets/rpg-audio", license: "CC0" },
  { key: "goal", title: "Pleasing Bell Sound Effect", author: "Spring Spring", url: "https://opengameart.org/content/pleasing-bell-sound-effect", license: "CC0" },
  { key: "levelup", title: "jingles_PIZZI07 (pizzicato strings) (Kenney 'Music Jingles' pack)", author: "Kenney (kenney.nl)", url: "https://kenney.nl/assets/music-jingles", license: "CC0" },
  { key: "refused", title: "impactSoft_heavy_000 (Kenney 'Impact Sounds' pack)", author: "Kenney (kenney.nl)", url: "https://kenney.nl/assets/impact-sounds", license: "CC0" },
  { key: "welcome", title: "Bell dings/chimes - bell_ding1", author: "PWL", url: "https://opengameart.org/content/bell-dingschimes", license: "CC0" },
  { key: "cluck", title: "Hen announcing shes lain an egg.ogg", author: "alys (pdsounds.org)", url: "https://commons.wikimedia.org/wiki/File:Hen_announcing_shes_lain_an_egg.ogg", license: "Public Domain" },
  { key: "cluck2", title: "Chickens demanding food.ogg", author: "alys (pdsounds.org)", url: "https://commons.wikimedia.org/wiki/File:Chickens_demanding_food.ogg", license: "Public Domain" },
  { key: "moo", title: "Cow And Bell", author: "unknown (SoundBible.com, Public Domain)", url: "https://soundbible.com/1143-Cow-And-Bell.html", license: "Public Domain" },
  { key: "moo2", title: "Single Cow", author: "BuffBill84 (SoundBible.com)", url: "https://soundbible.com/1572-Single-Cow.html", license: "CC-BY 3.0" },
  { key: "baa", title: "Sheep bleating.ogg", author: "earthcalling (pdsounds.org)", url: "https://commons.wikimedia.org/wiki/File:Sheep_bleating.ogg", license: "Public Domain" },
  { key: "baa2", title: "Sheep Baa", author: "AntumDeluge (from a recording by mikewest)", url: "https://opengameart.org/content/sheep-baa", license: "CC0" },
  { key: "ambience", title: "Birdsong mild sunny day.ogg", author: "stephan (pdsounds.org)", url: "https://commons.wikimedia.org/wiki/File:Birdsong_mild_sunny_day.ogg", license: "Public Domain" },
  { key: "music1", title: "Medieval: Harvest Season", author: "RandomMind", url: "https://opengameart.org/content/medieval-harvest-season", license: "CC0" },
  { key: "music2", title: "Northumberland (cover of 'The Fair Flower of Northumberland')", author: "Spring Spring", url: "https://opengameart.org/content/northumberland", license: "CC0" },
  { key: "music3", title: "Apple Cider", author: "Zane Little Music", url: "https://opengameart.org/content/apple-cider", license: "CC0" },
];
