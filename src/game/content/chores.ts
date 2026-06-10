import type { ChoreDef, ChoreId } from '../types';

/** Village chores: benched heroes earn slow gold/xp on wall-clock time (works offline). */
export const CHORES: Record<ChoreId, ChoreDef> = {
  farmhand: {
    id: 'farmhand',
    name: 'Farmhand',
    goldPerHour: 30,
    xpPerHour: 10,
    minLevel: 1,
    description: 'Honest work. The turnips do not bite. Usually.',
  },
  guard_duty: {
    id: 'guard_duty',
    name: 'Guard Duty',
    goldPerHour: 15,
    xpPerHour: 25,
    minLevel: 3,
    description: 'Stand at the gate and look intimidating.',
  },
  temple_assistant: {
    id: 'temple_assistant',
    name: 'Temple Assistant',
    goldPerHour: 5,
    xpPerHour: 15,
    minLevel: 1,
    description: 'Light candles, sweep floors, recover twice as fast.',
  },
  training_yard: {
    id: 'training_yard',
    name: 'Training Yard',
    goldPerHour: -20,
    xpPerHour: 40,
    minLevel: 1,
    description: 'Pay the drill sergeant to be yelled at. Surprisingly effective.',
  },
};
