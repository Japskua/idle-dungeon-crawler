/**
 * Gods & religions (ADOM-inspired). Faith is OPT-IN: a hero converts at the Guild
 * Hall, then earns FAVOR through devotions and loses it to taboos. Good standing
 * (Faithful+) grants the god's signature bonus; great standing (Exalted) can buy a
 * sudden divine resurrection; terrible standing (Forsaken) brings wrath. Non-
 * believers are mechanically neutral — no bonuses, no taboos, no wrath.
 *
 * v1 wires the generic favor loop + each god's SIGNATURE bonus + the resurrection
 * + a minor Forsaken penalty. The dozens of bespoke per-god effects (chicken
 * escorts, debt servicing, stealth blinks, manifestation avatars, …) live in the
 * descriptions and land in a follow-up. `favorRules` maps an event key the sim
 * already emits to a favor delta (positive = devotion, negative = taboo).
 */
import type { ReligionDef, StatMod } from '../types';

const dmg = (pct: number): StatMod => ({ kind: 'mult', what: 'dmg', mul: 1 + pct / 100 });
const gold = (pct: number): StatMod => ({ kind: 'mult', what: 'gold', mul: 1 + pct / 100 });
const xp = (pct: number): StatMod => ({ kind: 'mult', what: 'xp', mul: 1 + pct / 100 });
const maxhp = (pct: number): StatMod => ({ kind: 'mult', what: 'maxhp', mul: 1 + pct / 100 });

export const RELIGIONS: Record<string, ReligionDef> = {
  war_god: {
    id: 'war_god', name: 'The Iron Choir', deity: 'Vohrmund, the Unbroken Line', domain: 'war, courage, the front rank',
    description: 'A god who keeps a ledger of brave deaths and considers retreat a personal insult.',
    bonus: [dmg(10)], favorRules: { killMelee: 2, killBoss: 5, killElite: 2, withdrawNear: -5 },
    resurrectChance: 0.07, wrathDmgMult: 0.88, titheRate: 10,
    blessing: 'Last Stand — Vohrmund hauls the faithful back to their feet, blade still swinging.',
  },
  trickster_god: {
    id: 'trickster_god', name: 'The Sleight', deity: 'Cull, Who Counts Your Coins While Shaking Your Hand', domain: 'luck, theft, mischief, locked things',
    description: 'A god of beautiful lies who blesses the clever and fleeces the earnest.',
    bonus: [gold(15), { kind: 'mult', what: 'xp', mul: 1 }], favorRules: { chest: 2, killElite: 2 },
    resurrectChance: 0.06, wrathDmgMult: 0.92, titheRate: 20,
    blessing: 'Second Shadow — the faithful blink away into the dark and reappear mid-strike.',
  },
  poultry_god: {
    id: 'poultry_god', name: 'The Roost Eternal', deity: 'Cluxabeth, the Thousand-Feathered Hen', domain: 'poultry, eggs, dawn, suspicious calm',
    description: 'An absurd and surprisingly vengeful hen-goddess who guards every chicken in the dungeon.',
    bonus: [maxhp(10)], favorRules: { kill: 1, chickenKilled: -15 },
    resurrectChance: 0.05, wrathDmgMult: 0.92, titheRate: 10,
    blessing: 'Rise, My Chick — the faithful is reborn from a giant egg in a flurry of feathers.',
  },
  debt_god: {
    id: 'debt_god', name: 'The Ledger', deity: 'Marrow-Audit, Collector of All Owed', domain: 'debt, contracts, interest, inevitability',
    description: 'A cold accountant-god who lends power up front and always, always collects.',
    bonus: [dmg(8), gold(8)], favorRules: { chest: 1, killBoss: 3 },
    resurrectChance: 0.06, wrathDmgMult: 0.9, titheRate: 8,
    blessing: 'Debt Deferred — death is merely postponed; the bill comes due later.',
  },
  mushroom_god: {
    id: 'mushroom_god', name: 'The Mycelium Below', deity: 'Spü, the Spreading Quiet', domain: 'fungus, decay, patient growth',
    description: 'A vast underground intelligence that speaks in spores and outlasts everything.',
    bonus: [maxhp(12)], favorRules: { kill: 1, chest: 1 },
    resurrectChance: 0.06, wrathDmgMult: 0.92, titheRate: 10,
    blessing: 'Regrowth — the faithful knits back together from a single surviving spore.',
  },
  money_god: {
    id: 'money_god', name: 'The Gilded Smile', deity: 'Aurum Magnifico, His Excellency the Coin', domain: 'wealth, greed, commerce',
    description: 'A self-made god who believes everything, and everyone, has a price.',
    bonus: [gold(25)], favorRules: { chest: 3, kill: 1 },
    resurrectChance: 0.06, wrathDmgMult: 0.92, titheRate: 6,
    blessing: 'Golden Parachute — wealth buys the faithful one more breath.',
  },
  death_god: {
    id: 'death_god', name: 'The Last Door', deity: 'Mortishka, the Patient Hostess', domain: 'death, endings, the quiet rest',
    description: 'A gentle, inevitable god who is in no hurry — she knows everyone arrives eventually.',
    bonus: [dmg(6)], favorRules: { kill: 2, killBoss: 4 },
    resurrectChance: 0.12, wrathDmgMult: 0.9, titheRate: 10,
    blessing: 'Not Yet — Mortishka turns the faithful gently back from her door. (death-touched builds excel here.)',
  },
  sun_god: {
    id: 'sun_god', name: 'The Noon Eternal', deity: 'Solivar, Whose Eye Never Blinks', domain: 'light, judgment, relentless dawn',
    description: 'A blazing, exacting god who tolerates no shadow and no hesitation.',
    bonus: [xp(10), { kind: 'attr', attr: 'dex', add: 1 }], favorRules: { kill: 1, killElite: 2 },
    resurrectChance: 0.06, wrathDmgMult: 0.9, titheRate: 10,
    blessing: 'Dawnbreak — a pillar of light raises the faithful and scours the dark.',
  },
  storm_god: {
    id: 'storm_god', name: 'The Riotous Sky', deity: 'Krakaboom, the Applauding Thunder', domain: 'storms, chaos, sudden violence',
    description: 'A loud, fickle god who loves a big swing and a bigger noise.',
    bonus: [dmg(12)], favorRules: { killElite: 3, killBoss: 4 },
    resurrectChance: 0.06, wrathDmgMult: 0.85, titheRate: 10,
    blessing: 'Thunderclap — a bolt from nowhere jolts the faithful back upright.',
  },
  moon_god: {
    id: 'moon_god', name: 'The Pale Witness', deity: 'Lunalla, the Half-Closed Eye', domain: 'night, secrets, second chances',
    description: 'A watchful, ambivalent god who notices everything and judges almost none of it.',
    bonus: [{ kind: 'attr', attr: 'int', add: 1 }, xp(6)], favorRules: { kill: 1, chest: 1 },
    resurrectChance: 0.08, wrathDmgMult: 0.92, titheRate: 10,
    blessing: 'Moonlit Return — the faithful slips back from the dark between heartbeats.',
  },
  glutton_god: {
    id: 'glutton_god', name: 'The Endless Table', deity: 'Borbo, the Bottomless Gullet', domain: 'feasting, plenty, excess',
    description: 'A jolly, enormous god who measures devotion in second helpings.',
    bonus: [maxhp(15), dmg(4)], favorRules: { kill: 1, chest: 2 },
    resurrectChance: 0.05, wrathDmgMult: 0.92, titheRate: 10,
    blessing: 'One More Course — Borbo decides the faithful’s feast isn’t finished yet.',
  },
  bee_god: {
    id: 'bee_god', name: 'The Humming Comb', deity: 'Queen Apiastra, Whose Word Is Buzz', domain: 'bees, order, tireless industry',
    description: 'A vast, orderly hive-mind god who values diligence above all and never, ever rests.',
    bonus: [dmg(8), { kind: 'attr', attr: 'vit', add: 1 }], favorRules: { kill: 1, killElite: 2 },
    resurrectChance: 0.05, wrathDmgMult: 0.92, titheRate: 10,
    blessing: 'Swarm Tithe — the hive lifts the faithful on a thousand wings.',
  },
};

export const RELIGION_IDS = Object.keys(RELIGIONS);
