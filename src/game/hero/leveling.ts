/** XP gain and level-ups. Level-ups heal to full (small kindness, big feel). */
import type { GameEvent, GameState, Hero } from '../types';
import { CLASSES } from '../content';
import { xpForNextLevel } from '../balance';
import { derive } from './derive';
import { unlockedSkills } from './create';
import { applyMorale } from './morale';

export function addXp(state: GameState, hero: Hero, amount: number, events: GameEvent[]) {
  const d = derive(hero);
  const gained = Math.max(1, Math.round(amount * d.xpMult));
  hero.xp += gained;
  events.push({ t: 'xpGain', heroId: hero.id, amount: gained });

  const cls = CLASSES[hero.classId]!;
  let leveled = false;
  while (hero.xp >= xpForNextLevel(hero.level)) {
    hero.xp -= xpForNextLevel(hero.level);
    hero.level++;
    hero.attrs.str += cls.growth.str;
    hero.attrs.dex += cls.growth.dex;
    hero.attrs.int += cls.growth.int;
    hero.attrs.vit += cls.growth.vit;
    // merge, don't replace: skills learned early at the guild must survive level-ups
    for (const skillId of unlockedSkills(hero.classId, hero.level)) {
      if (!hero.skills.includes(skillId)) hero.skills.push(skillId);
    }
    leveled = true;
    events.push({ t: 'levelUp', heroId: hero.id, level: hero.level });
    applyMorale(hero, 4, 'levelup', events);
  }
  if (leveled) {
    const after = derive(hero);
    hero.hp = after.maxHp;
    hero.mp = after.maxMp;
  }
}
