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
};
