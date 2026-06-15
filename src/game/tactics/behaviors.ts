/**
 * Party behavior presets — a party-wide posture the player picks at the gate and
 * can switch any time in the dungeon. It overlays the per-hero tactic sets by
 * tuning a few knobs the decision code reads: how far the party wakes/chases
 * enemies, whether everyone piles onto one target, how aggressively they sip
 * potions, and whether they explore in order or wander.
 *
 * Pure data — the knobs are deterministic functions of the chosen mode, so the
 * sim stays golden-stable. 'balanced' is exactly the historical behavior.
 */
import type { PartyBehavior } from '../types';

export interface BehaviorKnobs {
  /** multiplies the engage radius — how far away enemies wake the party */
  engageMult: number;
  /** sticky-target leash, as a squared tile distance (give up the chase past this) */
  leash: number;
  /** everyone concentrates on a single shared target */
  focus: boolean;
  /** sip a healing potion whenever HP dips below this fraction (0 = off) */
  healthFloor: number;
  /** explore rooms in a shuffled, unpredictable order */
  wander: boolean;
}

const BALANCED: BehaviorKnobs = { engageMult: 1, leash: 144, focus: false, healthFloor: 0, wander: false };

export function behaviorKnobs(b: PartyBehavior | undefined): BehaviorKnobs {
  switch (b) {
    case 'together':
      return { engageMult: 0.6, leash: 64, focus: false, healthFloor: 0, wander: false };
    case 'aggressive':
      return { engageMult: 1.7, leash: 400, focus: false, healthFloor: 0, wander: false };
    case 'focus':
      return { ...BALANCED, focus: true };
    case 'conserve':
      return { ...BALANCED, healthFloor: 0.75 };
    case 'wander':
      return { ...BALANCED, wander: true };
    case 'balanced':
    default:
      return BALANCED;
  }
}

/** the order matters: this is how they render in the picker */
export const PARTY_BEHAVIORS: { id: PartyBehavior; name: string; blurb: string }[] = [
  { id: 'balanced', name: 'Balanced', blurb: 'Fight what’s near, explore, descend. The sensible default.' },
  { id: 'together', name: 'Stick Together', blurb: 'Stay bunched — don’t wake distant packs or chase strays.' },
  { id: 'aggressive', name: 'Attack Everything', blurb: 'Wake the whole floor and run foes down.' },
  { id: 'focus', name: 'Focus Fire', blurb: 'Everyone piles onto one enemy at a time.' },
  { id: 'conserve', name: 'Stay Healthy', blurb: 'Sip a potion whenever HP dips below 75%.' },
  { id: 'wander', name: 'Wander', blurb: 'Explore the floor in a roundabout, unpredictable order.' },
];
