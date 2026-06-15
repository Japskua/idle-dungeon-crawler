/**
 * The single morale mutation funnel. Every morale change in the sim flows
 * through here: scale the raw delta by the hero's trait gain/loss mults (and
 * Inspired damping), clamp to [-100,100], and emit a {t:'morale'} event for the
 * app-side banter director to voice. The sim owns the number; banter is flavor.
 */
import type { GameEvent, Hero } from '../types';
import { MORALE_MAX, MORALE_MIN, moraleBand, moraleBehavior, scaleMorale } from '../balance';

export function applyMorale(hero: Hero, base: number, source: string, events: GameEvent[]) {
  const fearless = moraleBehavior(moraleBand(hero.morale, hero.traits)).fearless;
  const delta = Math.round(scaleMorale(base, hero.traits, fearless));
  if (delta === 0) return;
  hero.morale = Math.max(MORALE_MIN, Math.min(MORALE_MAX, hero.morale + delta));
  events.push({ t: 'morale', heroId: hero.id, delta, source });
}
