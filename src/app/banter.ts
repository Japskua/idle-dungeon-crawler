/**
 * The banter director: watches the sim's event stream and decides when a hero
 * says something out loud — and what. Pure presentation: lives app-side, rolls
 * its own dice (Math.random), and never touches GameState, so the sim stays
 * deterministic and golden-stable no matter how chatty the party gets.
 *
 * What a hero says is shaped by:
 *  - their 2-3 personality TRAITS (line pools + interjection/tag decorations)
 *  - their CLASS voice (taunts per enemy family, kill lines, idle musings)
 *  - their PERKS (quirk shouts: the spoon collector eyes every chest)
 *  - their lifetime STATS (memory lines — a tiny story arc)
 *  - who they're talking TO (class-pair and role-pair exchanges)
 */
import type { GameEvent, GameState, Hero, Id } from '../game/types';
import { BANTER, CLASSES, MONSTERS, NEUTRALS } from '../game/content';

export interface Utterance {
  heroId: Id;
  text: string;
}

// ---------- frequency tuning (the "seldom" knobs) ----------
const GLOBAL_GAP_MS = 7_000; // min silence between ANY two utterances
const HERO_GAP_MS = 22_000; // min silence per hero
const IDLE_CHECK_MS = 9_000; // how often the quiet-halls dice roll
const COMBAT_QUIET_MS = 6_000; // no idle chatter this soon after a fight
const REPLY_DELAY_MS = 1_500; // beat before the other hero answers
const CONVERSATION_GAP_MS = 70_000; // min silence between multi-line conversations
/** chance each further reply happens — decays, so 6-line talks are rare */
const CONTINUE_CHANCE = [0.5, 0.38, 0.28, 0.18];
const CHANCE = {
  kill: 0.1,
  taunt: 0.12, // when a fight breaks out
  lowHp: 0.55, // once per hero per run
  allyDown: 0.55,
  rescue: 0.6,
  loot: 0.12,
  boss: 0.8,
  descend: 0.15,
  friendlyFire: 0.7,
  idleTick: 0.25, // per idle check while exploring
};

type Vars = Record<string, string>;

// ---------- pure helpers (unit-tested) ----------

/** replace {placeholders}; unknown ones collapse to a safe fallback */
export function fillTemplate(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? 'someone');
}

/** maybe wrap a line in a trait's interjection/tag; mime directions stay clean */
export function decorate(line: string, traitIds: string[], rand: () => number): string {
  if (line.startsWith('*')) return line;
  const traits = traitIds.map((id) => BANTER.traits.find((t) => t.id === id)).filter((t) => !!t);
  if (traits.length === 0) return line;
  const roll = rand();
  if (roll < 0.3) {
    const t = traits[Math.floor(rand() * traits.length)]!;
    if (t.interjections.length > 0) {
      const inter = t.interjections[Math.floor(rand() * t.interjections.length)]!;
      return `${inter} ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
    }
  } else if (roll < 0.5) {
    const t = traits[Math.floor(rand() * traits.length)]!;
    if (t.tags.length > 0) {
      const tag = t.tags[Math.floor(rand() * t.tags.length)]!;
      return `${line.replace(/[.!?]+$/, '')} ${tag}`;
    }
  }
  return line;
}

/** all the lines this hero could say for a context (traits + class voice) */
export function linePool(hero: Hero, context: string): string[] {
  const pool: string[] = [];
  for (const tid of hero.traits) {
    const trait = BANTER.traits.find((t) => t.id === tid);
    const lines = trait?.lines[context as keyof typeof trait.lines];
    if (lines) pool.push(...lines);
  }
  const voice = BANTER.voices[hero.classId];
  if (voice) {
    if (context === 'kill') pool.push(...voice.kill);
    if (context === 'idle') pool.push(...voice.idle);
  }
  // perk flavor leaks into matching contexts
  const perkCtx = context === 'descend' ? 'descend' : context === 'loot' ? 'chest' : context === 'idle' ? 'idle' : context === 'kill' ? 'combat' : null;
  if (perkCtx) {
    for (const pid of hero.perks) {
      const shouts = BANTER.perkShouts[pid];
      if (shouts) pool.push(...shouts.lines[perkCtx]);
    }
  }
  return mimeSafe(hero, pool);
}

/** the mime never speaks: only stage directions survive the filter */
function mimeSafe(hero: Hero, pool: string[]): string[] {
  return hero.classId === 'mime' ? pool.filter((l) => l.startsWith('*')) : pool;
}

/** conversation continuers: trait reactions + class voice reactions */
export function reactPool(hero: Hero): string[] {
  const pool: string[] = [];
  for (const tid of hero.traits) {
    const trait = BANTER.traits.find((t) => t.id === tid);
    if (trait?.lines.react) pool.push(...trait.lines.react);
  }
  const voice = BANTER.voices[hero.classId];
  if (voice?.react) pool.push(...voice.react);
  return mimeSafe(hero, pool);
}

/** stat-driven memory lines this hero has earned (their little story arc) */
export function memoryPool(hero: Hero): string[] {
  const s = hero.stats;
  const out: string[] = [];
  const grab = (id: string) => {
    const m = BANTER.memory.find((c) => c.id === id);
    if (m) out.push(...m.lines);
  };
  if (s.runs <= 1) grab('greenhorn');
  if (s.kills >= 200) grab('legend');
  else if (s.kills >= 50) grab('veteran');
  if (s.downs >= 3) grab('survivor');
  if (s.carriedOut >= 1) grab('grateful');
  if (s.biggestHitFrom) grab('haunted');
  if (s.rescues >= 2) grab('protector');
  if (s.runs >= 10 && s.downs === 0) grab('deathless');
  return out;
}

/** a taunt this hero would shout at this enemy (class voice by family) */
export function tauntPool(hero: Hero, defId: string): string[] {
  const voice = BANTER.voices[hero.classId];
  if (!voice) return [];
  const family = BANTER.families[defId] ?? 'generic';
  return [...(voice.taunts[family] ?? []), ...(voice.taunts['generic'] ?? [])];
}

/** find an exchange for two heroes: class pair first, role pair fallback */
export function pairExchange(
  a: Hero,
  b: Hero,
  rand: () => number,
): { first: Hero; second: Hero; lines: [string, string] } | null {
  const lookup = (list: typeof BANTER.classPairs, ka: string, kb: string) => {
    const direct = list.filter((p) => p.a === ka && p.b === kb);
    const flipped = list.filter((p) => p.a === kb && p.b === ka);
    if (direct.length + flipped.length === 0) return null;
    const all = [...direct.map((p) => ({ p, flip: false })), ...flipped.map((p) => ({ p, flip: true }))];
    const got = all[Math.floor(rand() * all.length)]!;
    const ex = got.p.exchanges[Math.floor(rand() * got.p.exchanges.length)];
    if (!ex) return null;
    return { flip: got.flip, ex };
  };
  let found = lookup(BANTER.classPairs, a.classId, b.classId);
  if (!found) {
    const ra = CLASSES[a.classId]?.role ?? '';
    const rb = CLASSES[b.classId]?.role ?? '';
    found = lookup(BANTER.rolePairs, ra, rb);
  }
  if (!found) return null;
  return found.flip
    ? { first: b, second: a, lines: found.ex }
    : { first: a, second: b, lines: found.ex };
}

function mobName(defId: string): string {
  return MONSTERS[defId]?.name ?? NEUTRALS[defId]?.name ?? defId;
}

// ---------- the director ----------

export class BanterDirector {
  private lastGlobalMs = 0;
  private lastByHero = new Map<Id, number>();
  private saidLowHp = new Set<Id>();
  private lastCombatMs = 0;
  private lastIdleCheckMs = 0;
  private lastConversationMs = 0;
  private pending: { atMs: number; u: Utterance }[] = [];
  /** last hero to damage each monster — credits the kill line */
  private lastHitBy = new Map<Id, Id>();
  private rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  /** a mime handed a spoken line performs something instead */
  private mimeLine(hero: Hero, line: string): string {
    if (hero.classId !== 'mime' || line.startsWith('*')) return line;
    const pool = reactPool(hero);
    if (pool.length > 0) return pool[Math.floor(this.rand() * pool.length)]!;
    return '*gestures eloquently*';
  }

  private gate(heroId: Id, nowMs: number, chance: number): boolean {
    if (this.rand() >= chance) return false;
    if (nowMs - this.lastGlobalMs < GLOBAL_GAP_MS) return false;
    if (nowMs - (this.lastByHero.get(heroId) ?? 0) < HERO_GAP_MS) return false;
    return true;
  }

  private speak(out: Utterance[], hero: Hero, raw: string, vars: Vars, nowMs: number) {
    const text = decorate(fillTemplate(raw, vars), hero.traits, this.rand);
    out.push({ heroId: hero.id, text });
    this.lastGlobalMs = nowMs;
    this.lastByHero.set(hero.id, nowMs);
  }

  private sayFrom(out: Utterance[], hero: Hero, pool: string[], vars: Vars, nowMs: number) {
    if (pool.length === 0) return;
    this.speak(out, hero, pool[Math.floor(this.rand() * pool.length)]!, vars, nowMs);
  }

  private baseVars(state: GameState, hero: Hero): Vars {
    return {
      hero: hero.name,
      depth: String(state.run?.depth ?? 1),
      kills: String(hero.stats.kills),
      downs: String(hero.stats.downs),
      worst: hero.stats.biggestHitFrom ?? 'something terrible',
      rescuer: 'a good friend',
    };
  }

  private standing(state: GameState): Hero[] {
    const run = state.run;
    if (!run) return [];
    return run.party.memberIds
      .filter((id) => !(id in run.party.downed))
      .map((id) => state.roster[id])
      .filter((h): h is Hero => !!h);
  }

  consume(state: GameState, events: GameEvent[], nowMs: number): Utterance[] {
    const out: Utterance[] = [];

    // scheduled replies come due
    while (this.pending.length > 0 && this.pending[0]!.atMs <= nowMs) {
      out.push(this.pending.shift()!.u);
    }

    for (const e of events) {
      switch (e.t) {
        case 'embark':
          this.saidLowHp.clear();
          this.lastHitBy.clear();
          break;
        case 'damage': {
          const srcHero = state.roster[e.src];
          const dstHero = state.roster[e.dst];
          if (srcHero && state.run?.monsters[e.dst]) {
            this.lastHitBy.set(e.dst, e.src);
            // a fight just broke out after a quiet spell: someone taunts
            if (nowMs - this.lastCombatMs > 8_000 && this.gate(e.src, nowMs, CHANCE.taunt)) {
              const defId = state.run.monsters[e.dst]!.defId;
              this.sayFrom(out, srcHero, tauntPool(srcHero, defId), {
                ...this.baseVars(state, srcHero),
                enemy: mobName(defId),
              }, nowMs);
            }
            this.lastCombatMs = nowMs;
          }
          if (dstHero) {
            this.lastCombatMs = nowMs;
            if (srcHero && srcHero.id !== dstHero.id) {
              // caught in a friend's explosion
              if (this.gate(e.dst, nowMs, CHANCE.friendlyFire)) {
                this.sayFrom(out, dstHero, linePool(dstHero, 'friendlyFire'), {
                  ...this.baseVars(state, dstHero),
                  ally: srcHero.name,
                }, nowMs);
              }
            } else if (!this.saidLowHp.has(e.dst)) {
              const maxHp = dstHero.hp + e.amount; // close enough for a fraction check
              if (dstHero.hp > 0 && dstHero.hp / Math.max(1, maxHp) < 0.4 && this.gate(e.dst, nowMs, CHANCE.lowHp)) {
                this.saidLowHp.add(e.dst);
                this.sayFrom(out, dstHero, linePool(dstHero, 'lowHp'), this.baseVars(state, dstHero), nowMs);
              }
            }
          }
          break;
        }
        case 'monsterDied': {
          const killerId = [...this.lastHitBy.entries()].find(([mid]) => !state.run?.monsters[mid])?.[1];
          const killer = killerId ? state.roster[killerId] : undefined;
          if (killer && this.gate(killer.id, nowMs, CHANCE.kill)) {
            this.sayFrom(out, killer, linePool(killer, 'kill'), {
              ...this.baseVars(state, killer),
              enemy: mobName(e.defId),
            }, nowMs);
          }
          break;
        }
        case 'heroDowned': {
          const downed = state.roster[e.heroId];
          const others = this.standing(state).filter((h) => h.id !== e.heroId);
          const speaker = others[Math.floor(this.rand() * Math.max(1, others.length))];
          if (downed && speaker && this.gate(speaker.id, nowMs, CHANCE.allyDown)) {
            this.sayFrom(out, speaker, linePool(speaker, 'allyDown'), {
              ...this.baseVars(state, speaker),
              ally: downed.name,
            }, nowMs);
          }
          break;
        }
        case 'heroCarried': {
          const carrier = state.roster[e.carrier];
          const carried = state.roster[e.carried];
          if (carrier && carried && this.gate(carrier.id, nowMs, CHANCE.rescue)) {
            this.sayFrom(out, carrier, linePool(carrier, 'rescue'), {
              ...this.baseVars(state, carrier),
              ally: carried.name,
            }, nowMs);
          }
          break;
        }
        case 'chestOpened': {
          const heroes = this.standing(state);
          const speaker = heroes[Math.floor(this.rand() * Math.max(1, heroes.length))];
          if (speaker && this.gate(speaker.id, nowMs, CHANCE.loot * 2)) {
            this.sayFrom(out, speaker, linePool(speaker, 'loot'), {
              ...this.baseVars(state, speaker),
              gold: String(e.gold),
            }, nowMs);
          }
          break;
        }
        case 'descend': {
          const heroes = this.standing(state);
          const speaker = heroes[Math.floor(this.rand() * Math.max(1, heroes.length))];
          if (!speaker) break;
          const boss = e.depth % 5 === 0;
          if (this.gate(speaker.id, nowMs, boss ? CHANCE.boss : CHANCE.descend)) {
            this.sayFrom(out, speaker, linePool(speaker, boss ? 'boss' : 'descend'), {
              ...this.baseVars(state, speaker),
              depth: String(e.depth),
            }, nowMs);
          }
          break;
        }
        default:
          break;
      }
    }

    // quiet halls: idle chatter, exchanges, memories
    if (state.run && nowMs - this.lastIdleCheckMs > IDLE_CHECK_MS) {
      this.lastIdleCheckMs = nowMs;
      const calm = nowMs - this.lastCombatMs > COMBAT_QUIET_MS;
      if (calm && this.rand() < CHANCE.idleTick) {
        const heroes = this.standing(state);
        if (
          heroes.length >= 2 &&
          this.rand() < 0.55 &&
          nowMs - this.lastConversationMs > CONVERSATION_GAP_MS
        ) {
          // a conversation: opener + reply, then maybe the rest chime in
          const i = Math.floor(this.rand() * heroes.length);
          let j = Math.floor(this.rand() * (heroes.length - 1));
          if (j >= i) j++;
          const ex = pairExchange(heroes[i]!, heroes[j]!, this.rand);
          if (ex && nowMs - this.lastGlobalMs > GLOBAL_GAP_MS) {
            this.lastConversationMs = nowMs;
            const varsA = { ...this.baseVars(state, ex.first), ally: ex.second.name };
            const varsB = { ...this.baseVars(state, ex.second), ally: ex.first.name };
            this.speak(out, ex.first, this.mimeLine(ex.first, ex.lines[0]), varsA, nowMs);
            let at = nowMs + REPLY_DELAY_MS;
            this.pending.push({
              atMs: at,
              u: {
                heroId: ex.second.id,
                text: decorate(fillTemplate(this.mimeLine(ex.second, ex.lines[1]), varsB), ex.second.traits, this.rand),
              },
            });
            this.lastByHero.set(ex.second.id, at);
            // the chain: decaying odds, fresh voices first, never the same
            // speaker twice in a row, hard cap = opener + reply + 4 reactions
            const spoken = new Set([ex.first.id, ex.second.id]);
            let prev = ex.second;
            for (const chance of CONTINUE_CHANCE) {
              if (this.rand() >= chance) break;
              const fresh = heroes.filter((h) => !spoken.has(h.id));
              const candidates = fresh.length > 0 ? fresh : heroes.filter((h) => h.id !== prev.id);
              if (candidates.length === 0) break;
              const speaker = candidates[Math.floor(this.rand() * candidates.length)]!;
              const pool = reactPool(speaker);
              if (pool.length === 0) break;
              at += REPLY_DELAY_MS + 400;
              const raw = pool[Math.floor(this.rand() * pool.length)]!;
              const text = decorate(
                fillTemplate(raw, { ...this.baseVars(state, speaker), ally: prev.name }),
                speaker.traits,
                this.rand,
              );
              this.pending.push({ atMs: at, u: { heroId: speaker.id, text } });
              this.lastByHero.set(speaker.id, at);
              spoken.add(speaker.id);
              prev = speaker;
            }
            this.lastGlobalMs = at; // nothing interleaves mid-conversation
          }
        } else if (heroes.length > 0) {
          // a solo musing — sometimes a memory surfaces instead
          const hero = heroes[Math.floor(this.rand() * heroes.length)]!;
          if (this.gate(hero.id, nowMs, 1)) {
            const memories = memoryPool(hero);
            const useMemory = memories.length > 0 && this.rand() < 0.3;
            const others = this.standing(state).filter((h) => h.id !== hero.id);
            const ally = others[Math.floor(this.rand() * Math.max(1, others.length))];
            this.sayFrom(out, hero, useMemory ? memories : linePool(hero, 'idle'), {
              ...this.baseVars(state, hero),
              ally: ally?.name ?? 'nobody in particular',
            }, nowMs);
          }
        }
      }
    }

    return out;
  }
}
