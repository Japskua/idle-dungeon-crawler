/**
 * Hero races (ADOM-inspired). A race is texture, not a strict upgrade: stat mods
 * sum to roughly zero with a signature strength and a matching weakness, and
 * rarity (tavern spawn weight) — never power — is what makes the weird ones rare.
 *
 * v1 wires the DECLARATIVE effects through the existing derive() StatMod engine:
 * attribute mods, HP/speed/damage/gold/xp multipliers, flat crit, flat armor and
 * carry multiplier. The bespoke combat procs (phase/dodge, distributed-body,
 * once-per-run survivals, regen, status immunities, scavenging, flee speed, the
 * personality-trait bias and the class-hire restrictions) are carried here as
 * DATA (immune/regen/flags/personalityBias/restrictions) and wired by the sim in
 * a follow-up — so the data is complete and the descriptions tell the full story.
 */
import type { RaceDef, StatMod } from '../types';

type Attrs = { str?: number; dex?: number; int?: number; vit?: number };

/** compile a race's declarative levers into StatMods derive() already understands */
function mods(a: Attrs, hpPct = 0, spdPct = 0, extra: StatMod[] = []): StatMod[] {
  const out: StatMod[] = [];
  for (const k of ['str', 'dex', 'int', 'vit'] as const) {
    if (a[k]) out.push({ kind: 'attr', attr: k, add: a[k]! });
  }
  if (hpPct) out.push({ kind: 'mult', what: 'maxhp', mul: 1 + hpPct / 100 });
  if (spdPct) out.push({ kind: 'mult', what: 'speed', mul: 1 + spdPct / 100 });
  return [...out, ...extra];
}
const dmg = (pct: number): StatMod => ({ kind: 'mult', what: 'dmg', mul: 1 + pct / 100 });
const gold = (pct: number): StatMod => ({ kind: 'mult', what: 'gold', mul: 1 + pct / 100 });
const xp = (pct: number): StatMod => ({ kind: 'mult', what: 'xp', mul: 1 + pct / 100 });

export const RACES: Record<string, RaceDef> = {
  human: {
    id: 'human',
    name: 'Human',
    description:
      'Unremarkable in every direction, which is its own kind of superpower — no glaring weakness, no signature gift, just a stubborn willingness to keep showing up.',
    mods: mods({}, 0, 0, [xp(10)]),
    rarity: 10,
    racialTraits: [
      { id: 'adaptable', name: 'Adaptable', effect: '+10% XP gain — learns a little faster than it has any right to.' },
      { id: 'ambitious', name: 'Ambitious', effect: 'Fits any class; convinced this is the run that pays off the mortgage.' },
    ],
    restrictions: [],
    quirks: ['Names its weapons. All of them, including the spare dagger.', 'Will explain why it is “basically the main character.”'],
    personalityBias: { boastful: 2, cheerful: 1.5 },
  },
  dwarf: {
    id: 'dwarf',
    name: 'Dwarf',
    description: 'Built like a load-bearing wall and roughly as movable. Tough and immovable; slow on its stubby legs and bored by finesse.',
    mods: mods({ str: 2, dex: -2, vit: 2 }, 10, -10),
    armorFlat: 1,
    immune: ['fear'],
    rarity: 9,
    racialTraits: [
      { id: 'stonehide', name: 'Stonehide', effect: '+10% max HP and a permanent point of innate armor.' },
      { id: 'ale_courage', name: 'Ale-Courage', effect: 'Never panics — immune to fear (and to a Fear of Chickens).' },
    ],
    restrictions: ['noClassId:mage'],
    quirks: ['Measures dungeon depth in “good cellar potential.”', 'Counts every coin twice, out loud, while standing in a fire.'],
    personalityBias: { gloomy: 1.5, greedy: 1.5, bloodthirsty: 1.3 },
  },
  elf: {
    id: 'elf',
    name: 'Elf',
    description: 'Elegant, exact, and very aware of both. Deadly precise and a touch magical; frail and first to fall if a troll looks at it.',
    mods: mods({ str: -2, dex: 2, int: 2, vit: -2 }, -5, 5, [gold(5)]),
    critBonus: 0.05,
    rarity: 9,
    racialTraits: [
      { id: 'keen_sight', name: 'Keen Sight', effect: '+5% crit chance and +5% gold from spotting loot others miss.' },
      { id: 'ageless', name: 'Ageless', effect: 'Refers to every other hero as “the young one.”' },
    ],
    restrictions: ['noClassId:barbarian'],
    quirks: ['Will not enter a room until the lighting is “acceptable.”', 'Has a centuries-long grudge against a specific door.'],
    personalityBias: { scholarly: 2, poetic: 1.8, boastful: 1.3 },
  },
  gnome: {
    id: 'gnome',
    name: 'Gnome',
    description: 'Tiny, brilliant, and a menace with anything that has a fuse. Brains and gadgets; physically negligible.',
    mods: mods({ str: -3, dex: 1, int: 4, vit: -2 }, -8, 0),
    immune: [],
    flags: ['bombMaster', 'smallTarget'],
    rarity: 8,
    racialTraits: [
      { id: 'tinkerer', name: 'Tinkerer', effect: 'Bombs hit harder and it packs an extra one. (wiring pending)' },
      { id: 'small_target', name: 'Small Target', effect: 'Hard to hit — small things are. (wiring pending)' },
    ],
    restrictions: ['noMetalArmor'],
    quirks: ['Refers to the dungeon as “the lab.”', 'Has invented a thing. It is on fire. This was anticipated.'],
    personalityBias: { scholarly: 2.5, cheerful: 1.3 },
  },
  half_orc: {
    id: 'half_orc',
    name: 'Half-Orc',
    description: 'Two heritages, both of which want to hit something. Raw muscle and a tusked grin; subtlety is not on the menu.',
    mods: mods({ str: 4, dex: -1, int: -3, vit: 2 }, 8, 0, [dmg(12)]),
    immune: ['stun', 'chilled'],
    rarity: 8,
    racialTraits: [
      { id: 'brutal', name: 'Brutal', effect: '+12% melee damage.' },
      { id: 'thick_skull', name: 'Thick Skull', effect: 'Immune to stun and chill — and to being told to be afraid.' },
    ],
    restrictions: ['noClassId:mage', 'noClassId:necromancer'],
    quirks: ['Solves riddles by eating them.', 'Has exactly one fork and is very protective of it.'],
    personalityBias: { bloodthirsty: 3, boastful: 2 },
  },
  halfling: {
    id: 'halfling',
    name: 'Halfling',
    description: 'Small, lucky, and perpetually thinking about second breakfast. Nimble and improbably fortunate; not built for a straight fight.',
    mods: mods({ str: -2, dex: 3, vit: -1 }, -3, 5, [gold(15)]),
    flags: ['luckyReroll'],
    rarity: 8,
    racialTraits: [
      { id: 'lucky_feet', name: 'Lucky Feet', effect: '+15% gold found, and improbably hard to finish off. (reroll wiring pending)' },
      { id: 'light_step', name: 'Light Step', effect: '+5% move speed; too light to set off weight-triggered hazards.' },
    ],
    restrictions: ['noClassId:knight'],
    quirks: ['Has snacks. Always more snacks. Where are they keeping the snacks.', 'Considers “retreat to the pantry” a valid tactic.'],
    personalityBias: { hungry: 3, cheerful: 2, bloodthirsty: 0.5 },
  },
  ratling: {
    id: 'ratling',
    name: 'Ratling',
    description: 'A whiskered scavenger that thrives in exactly the filthy corridor everyone else hates. Fast and disease-proof; flimsy.',
    mods: mods({ str: -2, dex: 4, vit: -3 }, -10, 12),
    immune: ['poisoned'],
    flags: ['scavenger', 'lowMorale'],
    rarity: 5,
    racialTraits: [
      { id: 'scavenger', name: 'Scavenger', effect: 'Finds things on the floor after a fight. (wiring pending)' },
      { id: 'plague_proof', name: 'Plague-Proof', effect: 'Immune to poison — thrives in the muck.' },
    ],
    restrictions: ['noClassId:paladin'],
    quirks: ['Maintains an off-the-books stash the party is not informed about.', 'Flinches at brooms. The ratling knows why.'],
    personalityBias: { greedy: 2, cowardly: 2, deadpan: 1.3 },
  },
  myconid: {
    id: 'myconid',
    name: 'Myconid',
    description: 'A walking mushroom person who speaks in spores and unsettling calm. Resilient and serene; weak-armed and slow.',
    mods: mods({ str: -3, dex: -1, int: 2, vit: 2 }, 5, -8),
    immune: ['poisoned'],
    regenPerTick: 0.2,
    flags: ['sporeCloud'],
    rarity: 4,
    racialTraits: [
      { id: 'regrowing_flesh', name: 'Regrowing Flesh', effect: 'Slowly knits itself back together over time. (regen wiring pending)' },
      { id: 'spore_cloud', name: 'Spore Cloud', effect: 'A petty, posthumous puff of poison when downed. (wiring pending)' },
    ],
    restrictions: ['noClassId:chef'],
    quirks: ['Photosynthesizes during rest and insists this counts as eating.', 'Considers the Beekeeper’s bees “cousins, sort of.”'],
    personalityBias: { poetic: 2.5, scholarly: 2, gloomy: 1.3 },
  },
  golem: {
    id: 'golem',
    name: 'Golem',
    description: 'Animated stone and clockwork with a job to do and no nerves to lose. Immensely durable and untiring; ponderous and humourless.',
    mods: mods({ str: 3, dex: -3, vit: 4 }, 25, -15),
    immune: ['poisoned', 'stun'],
    flags: ['cannotUsePotions', 'cannotBeHealedBySoup'],
    rarity: 3,
    racialTraits: [
      { id: 'stone_body', name: 'Stone Body', effect: '+25% max HP, immune to poison and stun. Built to last.' },
      { id: 'no_metabolism', name: 'No Metabolism', effect: 'Cannot drink potions or eat. (restriction wiring pending)' },
    ],
    restrictions: ['noClassId:chef', 'noClassId:bard'],
    quirks: ['Takes every order literally, including “hold the line.”', 'Does not understand puns and is visibly unbothered by this.'],
    personalityBias: { deadpan: 3, gloomy: 1.3 },
  },
  ghost_touched: {
    id: 'ghost_touched',
    name: 'Ghost-Touched',
    description: 'A mortal who came back slightly translucent and permanently chilly. Eerily evasive and magically attuned; physically faint.',
    mods: mods({ str: -2, dex: 1, int: 3, vit: -2 }, -5, 5, [dmg(10)]),
    flags: ['phaseFlicker', 'lowMorale'],
    rarity: 3,
    racialTraits: [
      { id: 'cold_presence', name: 'Cold Presence', effect: '+10% damage — the chill sharpens every strike.' },
      { id: 'phase_flicker', name: 'Phase Flicker', effect: 'Now you hit it, now you don’t. (phase wiring pending)' },
    ],
    restrictions: ['noClassId:barbarian'],
    quirks: ['Occasionally answers a question no one asked.', 'On a first-name basis with two of the graveyard residents.'],
    personalityBias: { gloomy: 2, poetic: 2, deadpan: 1.5 },
  },
  goblin: {
    id: 'goblin',
    name: 'Goblin',
    description: 'A small green opportunist who has never once stayed for the hard part. Cheap to hire and quick to grab loot; cowardly and fragile.',
    mods: mods({ str: -1, dex: 3, vit: -2 }, -8, 8, [gold(20)]),
    flags: ['lootSkim', 'fleeInstinct', 'cheapHire', 'lowMorale'],
    rarity: 6,
    racialTraits: [
      { id: 'loot_goblin', name: 'Loot Goblin', effect: '+20% gold — though some of it mysteriously ends up in its own pockets. (skim wiring pending)' },
      { id: 'survival_instinct', name: 'Survival Instinct', effect: 'Bolts for the exit when hurt. It has rarely died at all. (wiring pending)' },
    ],
    restrictions: ['noClassId:paladin', 'noClassId:cleric'],
    quirks: ['Has already calculated everyone’s resale value, including allies.', 'Keeps a “just in case” rock. Will not elaborate.'],
    personalityBias: { greedy: 3, cowardly: 2.5 },
  },
  lizardfolk: {
    id: 'lizardfolk',
    name: 'Lizardfolk',
    description: 'Cold-blooded, scaled, and serenely indifferent to your problems. Naturally armored and unshakably calm; sluggish when cold.',
    mods: mods({ str: 2, dex: 1, int: -2, vit: 1 }, 5, -2),
    armorFlat: 2,
    immune: ['fear', 'chilled'],
    flags: ['coldStart', 'lowMorale'],
    rarity: 5,
    racialTraits: [
      { id: 'natural_scales', name: 'Natural Scales', effect: '+2 innate armor that stacks with anything worn.' },
      { id: 'cold_blood', name: 'Cold Blood', effect: 'Unshakably calm — immune to fear and chill.' },
    ],
    restrictions: ['noClassId:bard'],
    quirks: ['Evaluates every ally purely on tactical usefulness, then says so.', 'Basks on any warm tile, briefly, no matter the situation.'],
    personalityBias: { deadpan: 2.5, scholarly: 1.3 },
  },
  pebble_giant: {
    id: 'pebble_giant',
    name: 'Pebble Giant',
    description: 'The runt of a giant clan — merely “very large.” Mighty and sturdy; slow, clumsy in tight halls, and eats like four heroes.',
    mods: mods({ str: 4, dex: -3, int: -1, vit: 3 }, 18, -10, [dmg(15)]),
    carryMult: 1.5,
    flags: ['expensiveUpkeep'],
    rarity: 4,
    racialTraits: [
      { id: 'giant_strength', name: 'Giant Strength', effect: '+15% melee damage and +50% carry capacity.' },
      { id: 'big_appetite', name: 'Big Appetite', effect: 'Eats like four heroes. The strength has a grocery bill. (upkeep wiring pending)' },
    ],
    restrictions: ['noClassId:thief', 'noClassId:mime'],
    quirks: ['Ducks reflexively in rooms with high ceilings out of habit.', 'Apologizes to every doorway it breaks. Breaks many doorways.'],
    personalityBias: { hungry: 2.5, cheerful: 1.5, boastful: 1.3 },
  },
  swarm: {
    id: 'swarm',
    name: 'Hivemind Swarm',
    description: 'Not one creature but a loosely-agreed-upon committee of small things in a hero costume. Distributed and resilient; weak per-unit.',
    mods: mods({ str: -2, dex: 2, int: 1, vit: 1 }, 0, 0),
    flags: ['distributedBody', 'quorum'],
    rarity: 2,
    racialTraits: [
      { id: 'distributed_body', name: 'Distributed Body', effect: 'No single blow takes it all down. (damage-cap wiring pending)' },
      { id: 'quorum', name: 'Quorum', effect: 'Occasionally pauses to take a brief democratic vote. (wiring pending)' },
    ],
    restrictions: ['noMetalArmor', 'noClassId:knight', 'noClassId:paladin'],
    quirks: ['Refers to itself as “we,” and occasionally as “most of us.”', 'Votes on banter responses, which is why they arrive slightly late.'],
    personalityBias: { scholarly: 1.5, deadpan: 1.5 },
  },
  skeleton: {
    id: 'skeleton',
    name: 'Reformed Skeleton',
    description: 'Once raised for nefarious purposes, now gainfully and cheerfully employed. Tireless and fearless; brittle to blunt force.',
    mods: mods({ str: 1, dex: 2, vit: -1 }, -5, 3),
    immune: ['poisoned', 'fear'],
    flags: ['brittleBones', 'cannotBeHealedBySoup'],
    rarity: 3,
    racialTraits: [
      { id: 'undying_calm', name: 'Undying Calm', effect: 'Already did death once and found it overrated — immune to poison and fear.' },
      { id: 'brittle_bones', name: 'Brittle Bones', effect: 'Hates a good blunt weapon; shrugs off blades between the ribs. (weapon-family wiring pending)' },
    ],
    restrictions: ['noClassId:cleric', 'noClassId:druid'],
    quirks: ['Cannot eat and has made peace with it, loudly, every meal.', 'Refers to the Necromancer as “my old manager.” It is awkward for both.'],
    personalityBias: { deadpan: 3, poetic: 1.5, hungry: 0.2 },
  },
  automaton_mime: {
    id: 'automaton_mime',
    name: 'Porcelain Doll',
    description: 'A child’s toy that woke up one night with a small fixed smile and big ambitions. Quick and fearless; fragile as painted china.',
    mods: mods({ str: -1, dex: 3, int: 1, vit: -3 }, -12, 6),
    critBonus: 0.08,
    flags: ['fragileChina', 'silentBanter'],
    rarity: 2,
    racialTraits: [
      { id: 'porcelain_grace', name: 'Porcelain Grace', effect: '+8% crit chance — every strike precise and a little theatrical.' },
      { id: 'fragile_china', name: 'Fragile China', effect: 'Cracks instead of breaking, once. (survival wiring pending)' },
    ],
    restrictions: ['noClassId:barbarian', 'noClassId:beekeeper'],
    quirks: ['Communicates entirely in tilts of the head.', 'Its painted smile never changes, which everyone has noted, repeatedly.'],
    personalityBias: { deadpan: 2, poetic: 1.5 },
  },
};

export const RACE_IDS = Object.keys(RACES);
