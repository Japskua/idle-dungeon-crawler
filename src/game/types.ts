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
  kind: 'attack' | 'cast' | 'potion' | 'defend' | 'retreat' | 'wait';
  targetId?: Id;
  skillId?: SkillId;
  potion?: PotionKind;
  ticksLeft: number;
  total: number;
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
  skills: SkillId[];
  perks: PerkId[];
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
  goldCarried: number;
  lootBag: ItemInstance[];
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
  party: PartyState;
  monsters: Record<Id, MonsterInstance>;
  monsterOrder: Id[];
  groundLoot: GroundLoot[];
  visitedRooms: number[];
  ticksOnFloor: number;
}

// ---------- village ----------
export interface VillageState {
  gold: number;
  inventory: ItemInstance[];
  potions: Record<PotionKind, number>;
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
  | { t: 'EMBARK'; memberIds: Id[]; startDepth: number }
  | { t: 'WITHDRAW' }
  | { t: 'ABANDON_HERO'; heroId: Id }
  | { t: 'SWITCH_TACTIC_SET'; heroId: Id; setId: Id }
  | { t: 'SET_TACTICS'; heroId: Id; sets: TacticSet[]; activeSetId: Id }
  | { t: 'BUY_STOCK_ITEM'; stockKey: string }
  | { t: 'BUY_POTION'; potion: PotionKind; qty: number }
  | { t: 'SELL_ITEM'; itemId: Id }
  | { t: 'SELL_ALL_JUNK' }
  | { t: 'EQUIP'; heroId: Id; itemId: Id }
  | { t: 'UNEQUIP'; heroId: Id; slot: EquipSlot }
  | { t: 'SET_HERO_POTIONS'; heroId: Id; potions: Record<PotionKind, number> }
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
  | { t: 'neutralSighted'; defId: MonsterDefId; pos: Vec2 }
  | { t: 'neutralKilled'; defId: MonsterDefId; pos: Vec2 }
  | { t: 'bossSlain'; defId: MonsterDefId; depth: number }
  | { t: 'embark'; depth: number; memberIds: Id[] }
  | { t: 'purchase'; what: string; cost: number }
  | { t: 'sold'; what: string; gold: number }
  | { t: 'hire'; heroId: Id; name: string; cost: number };
