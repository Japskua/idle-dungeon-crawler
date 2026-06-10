import type { StatusDef, StatusId } from '../types';

export const STATUSES: Record<StatusId, StatusDef> = {
  taunted: { id: 'taunted', name: 'Taunted', taunt: true },
  stunned: { id: 'stunned', name: 'Stunned', stun: true },
  poisoned: { id: 'poisoned', name: 'Poisoned', hpPerTick: -0.3 },
  blessed: { id: 'blessed', name: 'Blessed', mods: [{ kind: 'mult', what: 'dmg', mul: 1.15 }] },
};
