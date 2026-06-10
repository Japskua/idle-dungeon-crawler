/**
 * Command application — the only way the UI mutates the sim, applied at tick
 * boundaries. Village commands may use wall-clock time; dungeon ones never do.
 */
import type { Command, GameEvent, GameState } from './types';
import { startRun, chronicle } from './run/lifecycle';
import { POTION_PRICES, SELL_VALUE_FRACTION, healInjuryCost, instantHealCost, learnSkillCost, PERMADEATH_ON_ABANDON, INJURIES_ON_WIPE } from './balance';
import { CHORES, INJURIES, SKILLS, classDef, itemDef } from './content';
import { derive } from './hero/derive';
import { canEquip } from './hero/equipment';
import { makeItem } from './items/factory';
import { makeHero } from './hero/create';
import { effectiveHireCost, shopStock, tavernRecruits } from './village/shop';
import { chance, pickWeighted } from './core/rng';

export function applyCommand(state: GameState, cmd: Command, nowMs: number, events: GameEvent[]) {
  switch (cmd.t) {
    case 'EMBARK': {
      if (state.mode !== 'village') return;
      const depth = state.progress.checkpoints.includes(cmd.startDepth) || cmd.startDepth === 1 ? cmd.startDepth : 1;
      startRun(state, cmd.memberIds, depth, nowMs, events);
      return;
    }
    case 'WITHDRAW': {
      if (state.run && state.run.intent !== 'withdraw') {
        state.run.intent = 'withdraw';
        events.push({ t: 'withdrawOrdered' });
        chronicle(state, nowMs, 'The order is given: fall back to the surface!', state.run.depth);
      }
      return;
    }
    case 'ABANDON_HERO': {
      const run = state.run;
      const hero = state.roster[cmd.heroId];
      if (!run || !hero || !(cmd.heroId in run.party.downed)) return;
      // resolve their fate immediately; the party moves on
      run.party.memberIds = run.party.memberIds.filter((id) => id !== cmd.heroId);
      delete run.party.downed[cmd.heroId];
      for (const [carrier, carried] of Object.entries(run.party.carrying)) {
        if (carried === cmd.heroId) delete run.party.carrying[carrier];
      }
      if (chance(state.rng.loot, PERMADEATH_ON_ABANDON)) {
        delete state.roster[cmd.heroId];
        state.rosterOrder = state.rosterOrder.filter((id) => id !== cmd.heroId);
        state.progress.totalPermadeaths++;
        events.push({
          t: 'heroDied',
          heroId: cmd.heroId,
          name: hero.name,
          classId: hero.classId,
          level: hero.level,
          depth: run.depth,
          cause: 'abandoned by the party, on purpose, by name',
        });
        chronicle(state, nowMs, `${hero.name} was abandoned at depth ${run.depth} and never seen again.`, run.depth);
      } else {
        const pool = Object.values(INJURIES)
          .filter((inj) => inj.minDepth <= run.depth && !hero.injuries.includes(inj.id))
          .sort((a, b) => a.id.localeCompare(b.id));
        for (let i = 0; i < INJURIES_ON_WIPE && pool.length > 0; i++) {
          const injury = pickWeighted(state.rng.loot, pool, (x) => x.weight);
          pool.splice(pool.indexOf(injury), 1);
          hero.injuries.push(injury.id);
          events.push({ t: 'injury', heroId: hero.id, injuryId: injury.id });
        }
        hero.hp = 1;
        hero.activity = 'recovering';
        hero.statuses = [];
        hero.cooldowns = {};
        chronicle(state, nowMs, `${hero.name} was left behind... and somehow crawled home.`, run.depth);
      }
      return;
    }
    case 'SWITCH_TACTIC_SET': {
      const hero = state.roster[cmd.heroId];
      if (hero && hero.tactics.sets.some((s) => s.id === cmd.setId)) {
        hero.tactics.activeSetId = cmd.setId;
      }
      return;
    }
    case 'SET_TACTICS': {
      const hero = state.roster[cmd.heroId];
      if (hero && cmd.sets.length > 0) {
        hero.tactics.sets = cmd.sets;
        hero.tactics.activeSetId = cmd.sets.some((s) => s.id === cmd.activeSetId)
          ? cmd.activeSetId
          : cmd.sets[0]!.id;
      }
      return;
    }
    case 'BUY_POTION': {
      const price = POTION_PRICES[cmd.potion] * cmd.qty;
      if (cmd.qty > 0 && state.village.gold >= price) {
        state.village.gold -= price;
        state.village.potions[cmd.potion] += cmd.qty;
        events.push({ t: 'purchase', what: `${cmd.qty}x ${cmd.potion} potion`, cost: price });
      }
      return;
    }
    case 'BUY_STOCK_ITEM': {
      const entry = shopStock(state).find((e) => e.key === cmd.stockKey);
      if (!entry || state.village.purchasedToday.includes(cmd.stockKey)) return;
      if (state.village.gold < entry.price) return;
      state.village.gold -= entry.price;
      state.village.purchasedToday.push(cmd.stockKey);
      state.village.inventory.push(makeItem(state, entry.defId, Math.max(1, state.progress.maxDepthReached)));
      events.push({ t: 'purchase', what: itemDef(entry.defId).name, cost: entry.price });
      return;
    }
    case 'SELL_ALL_JUNK': {
      const junk = state.village.inventory.filter((it) => itemDef(it.defId).slot === 'junk');
      if (junk.length === 0) return;
      let gold = 0;
      for (const item of junk) {
        gold += Math.max(1, Math.round(itemDef(item.defId).value * SELL_VALUE_FRACTION));
      }
      state.village.inventory = state.village.inventory.filter((it) => itemDef(it.defId).slot !== 'junk');
      state.village.gold += gold;
      events.push({ t: 'sold', what: `${junk.length} oddities`, gold });
      return;
    }
    case 'SELL_ITEM': {
      const i = state.village.inventory.findIndex((it) => it.id === cmd.itemId);
      if (i === -1) return;
      const item = state.village.inventory[i]!;
      const gold = Math.max(1, Math.round(itemDef(item.defId).value * SELL_VALUE_FRACTION));
      state.village.inventory.splice(i, 1);
      state.village.gold += gold;
      return;
    }
    case 'EQUIP': {
      if (state.mode !== 'village') return;
      const hero = state.roster[cmd.heroId];
      const i = state.village.inventory.findIndex((it) => it.id === cmd.itemId);
      if (!hero || i === -1) return;
      const item = state.village.inventory[i]!;
      const def = itemDef(item.defId);
      const slot = def.slot;
      if (slot !== 'weapon' && slot !== 'offhand' && slot !== 'armor' && slot !== 'trinket') return;
      if (!canEquip(hero.classId, def)) return; // a mage holding a warhammer is a comedy, not a build
      // carry capacity: swapping counts the replaced item's weight as freed
      const d = derive(hero);
      const replaced = hero.equipment[slot];
      const replacedWeight = replaced ? itemDef(replaced.defId).weight : 0;
      if (d.carryUsed - replacedWeight + def.weight > d.carryMax + 1e-9) return; // too heavy
      state.village.inventory.splice(i, 1);
      const old = hero.equipment[slot];
      hero.equipment[slot] = item;
      if (old) state.village.inventory.push(old);
      return;
    }
    case 'UNEQUIP': {
      if (state.mode !== 'village') return;
      const hero = state.roster[cmd.heroId];
      const item = hero?.equipment[cmd.slot];
      if (!hero || !item) return;
      delete hero.equipment[cmd.slot];
      state.village.inventory.push(item);
      return;
    }
    case 'SET_HERO_POTIONS': {
      if (state.mode !== 'village') return;
      const hero = state.roster[cmd.heroId];
      if (!hero) return;
      for (const kind of ['hp', 'mp'] as const) {
        const want = Math.max(0, Math.floor(cmd.potions[kind] ?? hero.potions[kind]));
        const delta = want - hero.potions[kind];
        if (delta > 0) {
          const take = Math.min(delta, state.village.potions[kind]);
          state.village.potions[kind] -= take;
          hero.potions[kind] += take;
        } else if (delta < 0) {
          state.village.potions[kind] -= delta; // delta negative: returns to pool
          hero.potions[kind] = want;
        }
      }
      return;
    }
    case 'HIRE': {
      if (state.mode !== 'village') return;
      const recruit = tavernRecruits(state).find((r) => r.key === cmd.recruitKey);
      if (!recruit || state.village.hiredToday.includes(cmd.recruitKey)) return;
      const cost = effectiveHireCost(state, recruit);
      if (state.village.gold < cost) return;
      state.village.gold -= cost;
      state.village.hiredToday.push(cmd.recruitKey);
      const hero = makeHero(state, recruit.classId, recruit.name, recruit.level, recruit.perks);
      state.roster[hero.id] = hero;
      state.rosterOrder.push(hero.id);
      events.push({ t: 'hire', heroId: hero.id, name: hero.name, cost });
      chronicle(state, nowMs, `${hero.name} the ${classDef(hero.classId).name} joined the roster.`);
      return;
    }
    case 'DISMISS': {
      const hero = state.roster[cmd.heroId];
      if (!hero || hero.activity === 'party') return;
      delete state.roster[cmd.heroId];
      state.rosterOrder = state.rosterOrder.filter((id) => id !== cmd.heroId);
      return;
    }
    case 'ASSIGN_CHORE': {
      const hero = state.roster[cmd.heroId];
      if (!hero || hero.activity === 'party') return;
      for (const list of Object.values(state.village.chores)) {
        const i = list.indexOf(cmd.heroId);
        if (i !== -1) list.splice(i, 1);
      }
      if (cmd.choreId && CHORES[cmd.choreId] && hero.level >= CHORES[cmd.choreId]!.minLevel) {
        (state.village.chores[cmd.choreId] ??= []).push(cmd.heroId);
        hero.choreId = cmd.choreId;
        hero.activity = 'chore';
      } else {
        hero.choreId = undefined;
        if (hero.activity === 'chore') hero.activity = 'idle';
      }
      return;
    }
    case 'HEAL_INJURY': {
      const hero = state.roster[cmd.heroId];
      if (!hero || !hero.injuries.includes(cmd.injuryId)) return;
      const injury = INJURIES[cmd.injuryId];
      if (!injury) return;
      const cost = healInjuryCost(injury.healCostBase, injury.severity, hero.level);
      if (state.village.gold < cost) return;
      state.village.gold -= cost;
      hero.injuries = hero.injuries.filter((i) => i !== cmd.injuryId);
      events.push({ t: 'purchase', what: `Treated: ${injury.name} (${hero.name})`, cost });
      return;
    }
    case 'LEARN_SKILL': {
      if (state.mode !== 'village') return;
      const hero = state.roster[cmd.heroId];
      if (!hero || hero.skills.includes(cmd.skillId)) return;
      const skill = SKILLS[cmd.skillId];
      if (!skill) return;
      const cls = classDef(hero.classId);
      const unlock = cls.skillUnlocks.find((u) => u.skillId === cmd.skillId);
      let cost: number;
      if (unlock) {
        // class training: learn your own skill ahead of its level
        cost = learnSkillCost(unlock.level, unlock.level - hero.level);
      } else if (skill.guild) {
        // the open spellbook: anyone smart and seasoned enough may study
        if (hero.level < skill.guild.minLevel) return;
        if (derive(hero).attrs.int < skill.guild.minInt) return;
        cost = skill.guild.cost;
      } else {
        return; // monster moves and other classes' techniques are not for sale
      }
      if (state.village.gold < cost) return;
      state.village.gold -= cost;
      hero.skills.push(cmd.skillId);
      events.push({ t: 'purchase', what: `${hero.name} learned ${skill.name}`, cost });
      chronicle(state, nowMs, `${hero.name} studied at the Magician's Guild and learned ${skill.name}.`);
      return;
    }
    case 'REST_HERO': {
      const hero = state.roster[cmd.heroId];
      if (!hero || hero.activity === 'party') return;
      const d = derive(hero);
      const missing = Math.max(0, d.maxHp - hero.hp);
      const cost = instantHealCost(missing);
      if (missing <= 0 || state.village.gold < cost) return;
      state.village.gold -= cost;
      hero.hp = d.maxHp;
      hero.mp = d.maxMp;
      if (hero.activity === 'recovering') hero.activity = 'idle';
      events.push({ t: 'purchase', what: `Patched up ${hero.name}`, cost });
      return;
    }
  }
}
