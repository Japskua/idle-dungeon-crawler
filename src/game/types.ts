/**
 * The complete domain model. Everything in GameState is plain JSON-serializable
 * data (no classes, no Map/Set) except Uint8Array tile buffers, which the save
 * layer converts to base64. All mutation happens inside the pure sim (src/game).
 */

// ---------- ids ----------
export type Id = string;
export type ClassId = string;
export type SkillId = string;
export type ItemDefId = string;
export type MonsterDefId = string;
export type InjuryId = string;
export type PerkId = string;
export type ChoreId = string;
export type StatusId = string;

// ---------- math / rng ----------
export interface Vec2 {
  x: number;
  y: number;
}

/** mulberry32 state — a single u32, serializable. */
export interface Rng {
  s: number;
}

// ---------- sprites (pixel grids, compiled to an atlas at boot) ----------
export interface SpriteData {
  size: number;
  /** frames[f] is `size` rows of `size` palette characters ('.' = transparent). */
  frames: string[][];
  /** sim ticks per animation frame (default 4 = 2.5 fps at 10 tps). */
  frameTicks?: number;
}

// ---------- attributes & modifiers ----------
export interface Attributes {
  str: number;
  dex: number;
  int: number;
  vit: number;
}

export type StatMod =
  | { kind: 'attr'; attr: keyof Attributes; add: number }
  | { kind: 'mult'; what: 'dmg' | 'xp' | 'gold' | 'maxhp' | 'speed'; mul: number };

export interface ReligionDef {
  id: string;
  name: string;
  deity: string;
  domain: string;
  description: string;
  /** signature passive applied while favor is Faithful+ */
  bonus: StatMod[];
  /** event key -> favor delta (positive = devotion, negative = taboo) */
  favorRules: Record<string, number>;
  /** base divine-intervention chance at +61 favor (scales up toward +100) */
  resurrectChance: number;
  /** damage multiplier suffered while Forsaken */
  wrathDmgMult: number;
  /** gold per +1 favor when tithing */
  titheRate: number;
  blessing: string;
  /** rare divine manifestation: a boon while Exalted, a wrath while Forsaken */
  manifestation: Manifestation;
}

/** the kinds of rare divine event a god can visit on a believer at favor's extremes */
export type ManifestKind = 'smite' | 'bless' | 'bounty' | 'revive' | 'host' | 'scourge' | 'curse' | 'avatar';
export interface Manifestation {
  /** fires (rarely) while the believer is Exalted */
  boon: ManifestKind;
  /** fires (rarely) while the believer is Forsaken */
  wrath: ManifestKind;
  /** dramatic chronicle/log lines */
  boonText: string;
  wrathText: string;
  /** creature defId for 'host' (allied) and 'avatar' (hostile) manifestations */
  creature?: string;
}

/** a game of chance at the Gambler's Cove — one wager, one rng.village draw */
export interface CoveGame {
  id: string;
  name: string;
  blurb: string;
  /** probability of winning (winChance × payoutMult is < 1: the house edge) */
  winChance: number;
  /** a win pays stake × payoutMult (net gain (payoutMult−1) × stake) */
  payoutMult: number;
  minStake: number;
  maxStake: number;
  /** flavor lines; {gold} is replaced with the net winnings on a win */
  win: string;
  lose: string;
}

export interface RaceDef {
  id: string;
  name: string;
  description: string;
  /** declarative levers compiled into derive()'s StatMod engine */
  mods: StatMod[];
  /** flat additions read directly by derive() */
  critBonus?: number;
  armorFlat?: number;
  carryMult?: number;
  /** carried as data; the sim hooks land in a follow-up */
  immune?: string[];
  regenPerTick?: number;
  flags?: string[];
  personalityBias?: Record<string, number>;
  racialTraits: { id: string; name: string; effect: string }[];
  restrictions: string[];
  quirks: string[];
  /** tavern spawn weight — common 10, weird 2; never tied to power */
  rarity: number;
}

// ---------- content: items ----------
export type EquipSlot = 'weapon' | 'offhand' | 'armor' | 'trinket';
export type ItemSlot = EquipSlot | 'potion' | 'junk';
export type PotionKind = 'hp' | 'mp';
export type Rarity = 'common' | 'magic' | 'rare' | 'epic';

export interface ItemDef {
  id: ItemDefId;
  name: string;
  slot: ItemSlot;
  kind: string;
  tier: number;
  base?: {
    dmg?: number;
    attackTicks?: number;
    range?: number;
    armor?: number;
    /** extra ticks per tile while worn — heavy armor protects but slows */
    moveTicks?: number;
    stats?: Partial<Attributes>;
  };
  potion?: { kind: PotionKind; amount: number };
  /** kg — counts against a hero's carry capacity */
  weight: number;
  value: number;
  flavor?: string;
  sprite: SpriteData;
}

export interface Affix {
  id: string;
  name: string;
  mods: StatMod[];
}

export interface ItemInstance {
  id: Id;
  defId: ItemDefId;
  rarity: Rarity;
  affixes: Affix[];
  /** item level = monster level / depth it dropped at; scales affix strength. */
  ilvl: number;
}

// ---------- content: monsters & neutrals ----------
export interface SpawnBand {
  depths: [number, number];
  weight: number;
}

export interface DropEntry {
  item: ItemDefId;
  chance: number;
  qty?: [number, number];
}

export interface MonsterDef {
  id: MonsterDefId;
  name: string;
  tier: 'minion' | 'normal' | 'elite' | 'boss';
  disposition: 'hostile' | 'neutral';
  /** neutrals only */
  behavior?: 'wander' | 'flee';
  /** never spawns naturally — only conjured by summon skills */
  summonOnly?: boolean;
  base: {
    hp: number;
    dmg: number;
    armor: number;
    attackTicks: number;
    moveTicks: number;
    range: number;
    aggroRadius: number;
  };
  spawn: SpawnBand[];
  /** level rolled per spawn: triangular around (depth + offset), ± spread. */
  level: { offset: number; spread: number };
  xpBase: number;
  gold: [number, number];
  skills: SkillId[];
  drops: DropEntry[];
  sprite: SpriteData;
}

/** A tile-to-tile move in progress. `pos` is already the destination tile. */
export interface MoveProgress {
  from: Vec2;
  t: number;
  total: number;
}

export interface MonsterInstance {
  id: Id;
  defId: MonsterDefId;
  level: number;
  elite: boolean;
  hp: number;
  pos: Vec2;
  move: MoveProgress | null;
  targetId: Id | null;
  aggro: boolean;
  packId: number;
  action: EntityAction | null;
  statuses: StatusInstance[];
  cooldowns: Record<SkillId, number>;
  lastHitBy?: Id;
  /** set on friendly minions: the hero who conjured them */
  summonedBy?: Id;
  /** minions crumble when this reaches zero */
  ttlTicks?: number;
  /** menagerie-cost this minion counts against its summoner's cap (summoner & necro budgets) */
  summonCost?: number;
}

/** a fallen enemy the Necromancer can reanimate — floor-local, FIFO, cleared on descend */
export interface Corpse {
  defId: MonsterDefId;
  level: number;
  elite: boolean;
}

// ---------- content: skills & statuses ----------
export interface SkillDef {
  id: SkillId;
  name: string;
  kind: 'attack' | 'heal' | 'buff' | 'debuff' | 'summon';
  target: 'enemy' | 'lowestHpAlly' | 'self' | 'enemiesInRadius' | 'alliesInRadius';
  range: number;
  radius?: number;
  mpCost: number;
  cooldown: number;
  castTicks: number;
  /** multiplier on attack power (physical) or spell power (magical). */
  power: number;
  physical?: boolean;
  applies?: { statusId: StatusId; duration: number; chance: number }[];
  description: string;
  /** present = teachable at the Magician's Guild to any hero meeting the bar */
  guild?: { cost: number; minLevel: number; minInt: number };
  /** summon skills conjure friendly minions that fight alongside the party */
  summon?: { defId: MonsterDefId; count: number; durationTicks: number };
  /** menagerie-cost per summoned minion; presence enables the Summoner's cap (1.5× level) */
  summonCost?: number;
  /** Necromancer reanimation: consume floor corpses up to a 2× level undead-budget instead of a fixed summon */
  reanimate?: boolean;
  /** Gambler coin-flip: roll rng.combat vs 50% — Heads multiplies power by .heads, Tails by .tails */
  flip?: { heads: number; tails: number };
}

export interface StatusDef {
  id: StatusId;
  name: string;
  /** per-tick hp delta (negative = DoT), and/or stat mods while active. */
  hpPerTick?: number;
  mods?: StatMod[];
  taunt?: boolean;
  stun?: boolean;
  /** monsters cannot see, target, or hit this hero; broken by attacking */
  stealth?: boolean;
}

export interface StatusInstance {
  statusId: StatusId;
  ticksLeft: number;
  /** entity id of the applier (taunt target etc.). */
  sourceId: Id;
}

// ---------- content: classes ----------
export interface ClassDef {
  id: ClassId;
  name: string;
  role: 'tank' | 'healer' | 'melee_dps' | 'ranged_dps' | 'caster' | 'support';
  base: Attributes;
  growth: Attributes;
  baseHp: number;
  baseMp: number;
  /** kg before strength — fighters lug more than wizards */
  baseCarry: number;
  /** weapon kinds this class can wield (sword, dagger, bow, wand, ...) */
  weaponKinds: string[];
  /** armor/offhand kinds this class can wear (cloth, leather, plate, shield, ...) */
  armorKinds: string[];
  /** weaponless fighters (monks, mimes): fists that scale with level */
  unarmed?: { baseDmg: number; dmgPerLevel: number; attackTicks: number };
  startingItems: ItemDefId[];
  skillUnlocks: { level: number; skillId: SkillId }[];
  hireCostBase: number;
  description: string;
  sprite: SpriteData;
}

// ---------- content: injuries, perks, chores ----------
export interface InjuryDef {
  id: InjuryId;
  name: string;
  flavor: string;
  severity: 1 | 2 | 3;
  funny?: boolean;
  mods: StatMod[];
  healCostBase: number;
  minDepth: number;
  weight: number;
}

export interface PerkDef {
  id: PerkId;
  name: string;
  kind: 'modifier' | 'flavor' | 'startingItem';
  polarity: 'positive' | 'negative' | 'neutral';
  weight: number;
  mods: StatMod[];
  item?: ItemDefId;
  flavor: string;
}

export interface ChoreDef {
  id: ChoreId;
  name: string;
  goldPerHour: number;
  xpPerHour: number;
  minLevel: number;
  description: string;
}

export interface NameBanks {
  firstSyllables: string[];
  lastSyllables: string[];
  funnyNames: string[];
  epithets: string[];
  epithetChance: number;
  funnyChance: number;
}

export interface TileDef {
  id: string;
  sprite: SpriteData;
}

// ---------- tactics ----------
export type Trigger =
  | { k: 'always' }
  | { k: 'selfHpBelow'; pct: number }
  | { k: 'selfMpAbove'; pct: number }
  | { k: 'allyHpBelow'; pct: number }
  | { k: 'allyDowned' }
  | { k: 'enemiesAtLeast'; n: number }
  | { k: 'enemyIsBoss' }
  | { k: 'enemyIsElite' }
  | { k: 'enemyLevelAbove'; delta: number }
  | { k: 'inMeleeRange' }
  | { k: 'skillReady'; skillId: SkillId };

export type TacticAction =
  | { k: 'attack' }
  | { k: 'castSkill'; skillId: SkillId }
  | { k: 'usePotion'; potion: PotionKind }
  | { k: 'throwBomb' }
  | { k: 'defend' }
  | { k: 'retreat' }
  | { k: 'carryAlly' }
  | { k: 'wait' };

export interface TacticRule {
  id: Id;
  enabled: boolean;
  trigger: Trigger;
  action: TacticAction;
}

export interface TacticSet {
  id: Id;
  name: string;
  rules: TacticRule[];
}

// ---------- heroes ----------
export type HeroActivity = 'idle' | 'party' | 'chore' | 'recovering';

/** the story arc that comes to everyone */
export interface HeroStats {
  runs: number;
  kills: number;
  dmgDealt: number;
  /** damage dealt in the current crawl (reset at embark) */
  runDmg: number;
  /** gold found in the current crawl (reset at embark; this-run gold is lost on a wipe) */
  runGold: number;
  bestRunDmg: number;
  biggestHitTaken: number;
  biggestHitFrom?: string;
  downs: number;
  lastDownedHow?: string;
  /** most recent thing that hurt them, e.g. "Lvl 4 Cave Slime" */
  lastHitByName?: string;
  /** times they were carried out of the dungeon by a friend */
  carriedOut: number;
  /** times they carried a downed friend to safety */
  rescues: number;
}

export interface EntityAction {
  kind: 'attack' | 'cast' | 'potion' | 'defend' | 'retreat' | 'wait' | 'bomb';
  targetId?: Id;
  skillId?: SkillId;
  potion?: PotionKind;
  /** ground cell captured when the action committed (bombs explode here) */
  at?: Vec2;
  ticksLeft: number;
  total: number;
}

export interface OwnershipTraits {
  /** won't let their personal gold buy gear for ANOTHER hero */
  greedy?: boolean;
  /** resists giving up earned items — unequip/transfer can fail on a roll */
  loneWolf?: boolean;
  /** auto-gambles their own gold while the player idles in the village */
  gamblingAddiction?: boolean;
}

export interface Hero {
  id: Id;
  name: string;
  classId: ClassId;
  level: number;
  xp: number;
  hp: number;
  mp: number;
  attrs: Attributes;
  equipment: Partial<Record<EquipSlot, ItemInstance>>;
  potions: Record<PotionKind, number>;
  /** bombs in the pack — thrown via tactics, explosions spare no one */
  bombs: number;
  /** gold this hero personally owns — earned in the dungeon, never auto-shared */
  gold: number;
  /** unequipped items this hero personally carries (their pack) */
  satchel: ItemInstance[];
  /** typed economy/ownership flags (greedy / lone-wolf / gambling-addiction) */
  ownership?: OwnershipTraits;
  skills: SkillId[];
  perks: PerkId[];
  /** ancestry — stat mods, racial traits, quirks (see content/races.ts) */
  raceId: string;
  /** -100..+100, sim-owned; persists between runs, decays toward baseline in the village */
  morale: number;
  /** chosen god + per-hero favor (-100..+100); null = non-believer */
  faith: { religionId: string; favor: number } | null;
  /** Gambler signature: luck coins in hand (0-3), a re-roll/force-Heads currency; reset to 1 each floor */
  luckCoins: number;
  /** Priest signature: Devotion meter (0-100), reset to 20 each floor; ≥70 = State of Grace */
  devotion: number;
  /** Grave Robber signature: Greed stacks (0-10), built on loot/kills this run; spent by Pocket It, reset in the village */
  greed: number;
  /** Summoner signature: Menagerie Unleashed frenzy window countdown (ticks); >0 raises the cap and buffs minions */
  frenzyTicks: number;
  /** 2-3 personality trait ids — they shape what this hero says */
  traits: string[];
  injuries: InjuryId[];
  statuses: StatusInstance[];
  cooldowns: Record<SkillId, number>;
  activity: HeroActivity;
  choreId?: ChoreId;
  /** fractional chore-xp accumulator (whole points are granted as xp). */
  choreXpCarry?: number;
  tactics: { sets: TacticSet[]; activeSetId: Id };
  stats: HeroStats;
}

// ---------- banter (what heroes say; pure presentation data) ----------
export type BanterContext =
  | 'kill'
  | 'hurt'
  | 'lowHp'
  | 'allyDown'
  | 'rescue'
  | 'loot'
  | 'boss'
  | 'descend'
  | 'idle'
  | 'friendlyFire'
  | 'react';

export interface BanterTrait {
  id: string;
  name: string;
  blurb: string;
  weight: number;
  /** short openers spliced before a line */
  interjections: string[];
  /** short closers appended after a line */
  tags: string[];
  lines: Record<BanterContext, string[]>;
}

export interface BanterVoice {
  id: ClassId;
  /** shouted at enemies, keyed by enemy family (+ 'generic') */
  taunts: Record<string, string[]>;
  kill: string[];
  idle: string[];
  /** conversation continuers: responses that follow anything an ally said */
  react: string[];
}

export interface BanterPair {
  /** class ids for classPairs, role names for rolePairs */
  a: string;
  b: string;
  /** [opener by a, reply by b] */
  exchanges: [string, string][];
}

export interface BanterPerkLines {
  id: PerkId;
  lines: { idle: string[]; descend: string[]; chest: string[]; combat: string[] };
}

export interface BanterMemoryLines {
  id: string;
  when: string;
  lines: string[];
}

export interface BanterContent {
  traits: BanterTrait[];
  voices: Record<string, BanterVoice>;
  rolePairs: BanterPair[];
  classPairs: BanterPair[];
  perkShouts: Record<string, BanterPerkLines>;
  memory: BanterMemoryLines[];
  /** monster defId -> enemy family used by taunt tables */
  families: Record<string, string>;
}

export type EventEffect =
  | { k: 'loot'; depthBonus?: number }
  | { k: 'gold'; amount: number }
  | { k: 'goldDepth'; mult: number }
  | { k: 'spendGold'; amount: number }
  | { k: 'trap'; dmgBase: number; status?: string; statusTicks?: number; selfOnly?: boolean }
  | { k: 'spawnEnemy'; defId: string; elite?: boolean; count?: number }
  | { k: 'spawnAlly'; defId: string; ttl: number }
  | { k: 'heal'; amount: number }
  | { k: 'grantPotion'; kind: PotionKind; n: number }
  | { k: 'spendPotion'; kind: PotionKind }
  | { k: 'bless'; ticks: number }
  | { k: 'morale'; delta: number }
  | { k: 'favor'; delta: number };

export interface EventOutcome { weight: number; effects: EventEffect[]; text: string }
export interface EventChoice { key: string; label: string; default?: boolean; outcomes: EventOutcome[] }
export interface DungeonEventDef {
  id: string;
  name: string;
  prompt: string;
  minDepth: number;
  rarity: number;
  choices: EventChoice[];
}

/** a dungeon event awaiting the player's choice — pauses exploration until resolved */
export interface PendingEvent {
  eventId: string;
  roomIndex: number;
  choiceKeys: string[];
  defaultChoice: string;
  deadlineTick: number;
}

export type PartyBehavior =
  | 'balanced'
  | 'together'
  | 'aggressive'
  | 'focus'
  | 'conserve'
  | 'wander';

// ---------- dungeon ----------
export const TILE = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS_DOWN: 3,
  ENTRANCE: 4,
  /** boss arena doors slam shut while the boss lives */
  DOOR_CLOSED: 5,
} as const;
export type TileKind = (typeof TILE)[keyof typeof TILE];

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Chest {
  id: Id;
  pos: Vec2;
  opened: boolean;
}

export interface Floor {
  depth: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  rooms: Room[];
  /** adjacency lists between room indices (corridor connections). */
  roomGraph: number[][];
  entrance: Vec2;
  stairs: Vec2;
  chests: Chest[];
  explored: Uint8Array;
  isBossFloor: boolean;
  /** arena door tiles on boss floors (toggled DOOR <-> DOOR_CLOSED) */
  bossDoors?: Vec2[];
}

export interface PartyState {
  memberIds: Id[];
  pos: Record<Id, Vec2>;
  move: Record<Id, MoveProgress | null>;
  action: Record<Id, EntityAction | null>;
  targetId: Record<Id, Id | null>;
  /** heroId -> where they fell. Downed heroes are out of combat. */
  downed: Record<Id, { pos: Vec2 }>;
  /** carrierId -> downed heroId being carried. */
  carrying: Record<Id, Id>;
}

export interface GroundLoot {
  id: Id;
  pos: Vec2;
  item: ItemInstance;
  /** already reported as too heavy — don't spam the log */
  heavy?: boolean;
}

export interface DungeonRun {
  runSeed: number;
  depth: number;
  floor: Floor;
  intent: 'explore' | 'withdraw';
  /** party-wide posture overlaying per-hero tactics (see tactics/behaviors.ts) */
  behavior: PartyBehavior;
  /** an interactive event awaiting the player's choice (pauses exploration) */
  pendingEvent?: PendingEvent;
  /** party morale (0-100, starts 50) — scaffolding nudged by events */
  morale: number;
  /** divine favor (starts 0) — scaffolding nudged by events */
  favor: number;
  party: PartyState;
  monsters: Record<Id, MonsterInstance>;
  monsterOrder: Id[];
  groundLoot: GroundLoot[];
  visitedRooms: number[];
  ticksOnFloor: number;
  /** Necromancer corpse pool: enemies killed near a necromancer this floor (FIFO, cap 6) */
  corpses?: Corpse[];
  /** heroes who've already had their one rare divine manifestation this run */
  manifested?: Id[];
}

// ---------- village ----------
export interface VillageState {
  gold: number;
  inventory: ItemInstance[];
  potions: Record<PotionKind, number>;
  /** bomb crate by the store counter */
  bombs: number;
  /** choreId -> assigned hero ids. */
  chores: Record<ChoreId, Id[]>;
  lastChoreAccrualMs: number;
  /** fractional chore-gold accumulator. */
  choreGoldCarry?: number;
  /** stock keys bought today (stock itself is derived, never stored). */
  purchasedToday: string[];
  hiredToday: string[];
  dayIndex: number;
}

// ---------- meta ----------
export interface ChronicleEntry {
  atMs: number;
  depth?: number;
  text: string;
}

export interface Progress {
  maxDepthReached: number;
  bossesSlain: MonsterDefId[];
  /** depths the party may start a run from (cleared boss floors + 1). */
  checkpoints: number[];
  totalWipes: number;
  totalPermadeaths: number;
  runsCompleted: number;
}

export interface GameState {
  v: number;
  seed: number;
  /** dungeon sim tick counter (advances only while a run is live). */
  tick: number;
  savedAtMs: number;
  nextId: number;
  rng: { combat: Rng; loot: Rng; village: Rng };
  mode: 'village' | 'dungeon';
  village: VillageState;
  roster: Record<Id, Hero>;
  rosterOrder: Id[];
  run: DungeonRun | null;
  progress: Progress;
  chronicle: ChronicleEntry[];
}

// ---------- commands (UI -> sim, applied at tick boundaries) ----------
export type Command =
  | { t: 'EMBARK'; memberIds: Id[]; startDepth: number; behavior?: PartyBehavior }
  | { t: 'WITHDRAW' }
  | { t: 'ABANDON_HERO'; heroId: Id }
  | { t: 'SWITCH_TACTIC_SET'; heroId: Id; setId: Id }
  | { t: 'SET_PARTY_BEHAVIOR'; behavior: PartyBehavior }
  | { t: 'SET_HERO_FAITH'; heroId: Id; religionId: string | null }
  | { t: 'TITHE'; heroId: Id; amount: number }
  | { t: 'GAMBLE'; gameId: string; stake: number }
  | { t: 'EVENT_CHOICE'; eventId: string; choiceKey: string }
  | { t: 'SET_TACTICS'; heroId: Id; sets: TacticSet[]; activeSetId: Id }
  | { t: 'BUY_STOCK_ITEM'; stockKey: string }
  | { t: 'BUY_POTION'; potion: PotionKind; qty: number }
  | { t: 'BUY_BOMB'; qty: number }
  | { t: 'SELL_ITEM'; itemId: Id }
  | { t: 'SELL_ALL_JUNK' }
  | { t: 'EQUIP'; heroId: Id; itemId: Id }
  | { t: 'UNEQUIP'; heroId: Id; slot: EquipSlot }
  | { t: 'SET_HERO_POTIONS'; heroId: Id; potions: Record<PotionKind, number> }
  | { t: 'SET_HERO_BOMBS'; heroId: Id; bombs: number }
  | { t: 'DEPOSIT_GOLD'; heroId: Id; amount: number }
  | { t: 'WITHDRAW_GOLD'; heroId: Id; amount: number }
  | { t: 'TRANSFER_GOLD'; fromHeroId: Id; toHeroId: Id; amount: number }
  | { t: 'DEPOSIT_ITEM'; heroId: Id; itemId: Id }
  | { t: 'TRANSFER_ITEM'; fromHeroId: Id; toHeroId: Id; itemId: Id }
  | { t: 'SELL_SATCHEL_ITEM'; heroId: Id; itemId: Id }
  | { t: 'HIRE'; recruitKey: string }
  | { t: 'DISMISS'; heroId: Id }
  | { t: 'ASSIGN_CHORE'; heroId: Id; choreId: ChoreId | null }
  | { t: 'HEAL_INJURY'; heroId: Id; injuryId: InjuryId }
  | { t: 'REST_HERO'; heroId: Id }
  | { t: 'LEARN_SKILL'; heroId: Id; skillId: SkillId };

// ---------- events (sim -> log/fx/tests, transient) ----------
export type GameEvent =
  | { t: 'damage'; src: Id; dst: Id; amount: number; crit: boolean; pos: Vec2; srcPos?: Vec2 }
  | { t: 'heal'; src: Id; dst: Id; amount: number; pos: Vec2 }
  | { t: 'skillCast'; src: Id; skillId: SkillId }
  | { t: 'potionUsed'; heroId: Id; potion: PotionKind; amount: number; pos: Vec2 }
  | { t: 'bombThrown'; heroId: Id; pos: Vec2 }
  | { t: 'transferRefused'; heroId: Id; itemId: Id }
  | { t: 'eventOpened'; eventId: string }
  | { t: 'eventResolved'; eventId: string; choiceKey: string; resultText: string }
  | { t: 'morale'; heroId: Id; delta: number; source: string }
  | { t: 'moraleBeat'; from: Id; to: Id; valence: 'cheer' | 'jeer' }
  | { t: 'favor'; heroId: Id; delta: number; religionId: string }
  | { t: 'divineIntervention'; heroId: Id; religionId: string }
  | { t: 'divineManifestation'; heroId: Id; religionId: string; kind: ManifestKind; boon: boolean; text: string }
  | { t: 'monsterDied'; id: Id; defId: MonsterDefId; level: number; xp: number; gold: number; pos: Vec2 }
  | { t: 'lootDropped'; defId: ItemDefId; pos: Vec2 }
  | { t: 'lootPicked'; defId: ItemDefId; by: Id }
  | { t: 'lootTooHeavy'; defId: ItemDefId }
  | { t: 'chestOpened'; gold: number; items: ItemDefId[]; pos: Vec2 }
  | { t: 'heroDowned'; heroId: Id; pos: Vec2 }
  | { t: 'heroCarried'; carrier: Id; carried: Id }
  | { t: 'heroDied'; heroId: Id; name: string; classId: ClassId; level: number; depth: number; cause: string }
  | { t: 'injury'; heroId: Id; injuryId: InjuryId }
  | { t: 'levelUp'; heroId: Id; level: number }
  | { t: 'xpGain'; heroId: Id; amount: number }
  | { t: 'descend'; depth: number }
  | { t: 'withdrawOrdered' }
  | { t: 'runEnded'; outcome: 'withdrawn' | 'wiped'; depth: number; goldKept: number; goldLost: number }
  | { t: 'wipe'; depth: number; goldLost: number }
  | { t: 'summon'; heroId: Id; defId: MonsterDefId; count: number }
  | { t: 'minionDied'; defId: MonsterDefId; pos: Vec2 }
  | { t: 'coinFlip'; heroId: Id; heads: boolean; coins: number; skillId: SkillId }
  | { t: 'gamble'; gameId: string; stake: number; won: boolean; delta: number }
  | { t: 'pocketIt'; heroId: Id; stacks: number; gold: number }
  | { t: 'corpseExplosion'; heroId: Id; pos: Vec2 }
  | { t: 'neutralSighted'; defId: MonsterDefId; pos: Vec2 }
  | { t: 'neutralKilled'; defId: MonsterDefId; pos: Vec2 }
  | { t: 'bossSlain'; defId: MonsterDefId; depth: number }
  | { t: 'embark'; depth: number; memberIds: Id[] }
  | { t: 'purchase'; what: string; cost: number; category?: 'gear' | 'potion' | 'healing' | 'training'; refId?: string }
  | { t: 'sold'; what: string; gold: number }
  | { t: 'hire'; heroId: Id; name: string; cost: number };
