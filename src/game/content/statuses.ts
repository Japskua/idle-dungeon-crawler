import type { StatusDef, StatusId } from '../types';

export const STATUSES: Record<StatusId, StatusDef> = {
  taunted: { id: 'taunted', name: 'Taunted', taunt: true },
  stunned: { id: 'stunned', name: 'Stunned', stun: true },
  poisoned: { id: 'poisoned', name: 'Poisoned', hpPerTick: -0.3 },
  blessed: { id: 'blessed', name: 'Blessed', mods: [{ kind: 'mult', what: 'dmg', mul: 1.15 }] },
  chilled: { id: 'chilled', name: 'Chilled', stun: true },
  regrowth: { id: 'regrowth', name: 'Regrowth', hpPerTick: 0.6 },
  stealthed: { id: 'stealthed', name: 'In Shadow', stealth: true },
  enraged: { id: 'enraged', name: 'Enraged', mods: [{ kind: 'mult', what: 'dmg', mul: 1.4 }] },
  // gambler: rigged the odds (+dmg) vs whiffed a bet (-dmg)
  loaded: { id: 'loaded', name: 'Loaded Dice', mods: [{ kind: 'mult', what: 'dmg', mul: 1.2 }] },
  fumbled: { id: 'fumbled', name: 'Fumbled', mods: [{ kind: 'mult', what: 'dmg', mul: 0.85 }] },
  // summoner: the whole menagerie cut loose (+dmg & speed)
  empowered: { id: 'empowered', name: 'Empowered', mods: [{ kind: 'mult', what: 'dmg', mul: 1.25 }, { kind: 'mult', what: 'speed', mul: 1.2 }] },
  // grave robber: the thrill of treasure (gold-find up) and a looter's light step (speed)
  greedy_focus: { id: 'greedy_focus', name: 'Greedy Focus', mods: [{ kind: 'mult', what: 'gold', mul: 1.2 }] },
  lucky_dig: { id: 'lucky_dig', name: 'Lucky Dig', mods: [{ kind: 'mult', what: 'gold', mul: 1.3 }] },
  evasive: { id: 'evasive', name: 'Evasive', mods: [{ kind: 'mult', what: 'speed', mul: 1.3 }] },
  // a forsaken god's hex: weak and sluggish until it lifts
  cursed: { id: 'cursed', name: 'Cursed', mods: [{ kind: 'mult', what: 'dmg', mul: 0.6 }, { kind: 'mult', what: 'speed', mul: 0.8 }] },
};
