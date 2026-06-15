/**
 * The favor mutation funnel — the religion counterpart to applyMorale. Looks up
 * the hero's god, applies the matching devotion/taboo delta (if any), clamps, and
 * emits a {t:'favor'} event. No-op for non-believers, so faith stays opt-in.
 */
import type { GameEvent, Hero } from '../types';
import { RELIGIONS } from '../content';
import { FAVOR_MAX, FAVOR_MIN } from '../balance';

export function applyFavor(hero: Hero, key: string, events: GameEvent[]) {
  const faith = hero.faith;
  if (!faith) return;
  const rel = RELIGIONS[faith.religionId];
  if (!rel) return;
  const delta = rel.favorRules[key];
  if (!delta) return;
  faith.favor = Math.max(FAVOR_MIN, Math.min(FAVOR_MAX, faith.favor + delta));
  events.push({ t: 'favor', heroId: hero.id, delta, religionId: faith.religionId });
}
