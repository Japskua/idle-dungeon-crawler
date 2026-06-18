/**
 * The graveyard remembers every fallen hero FOREVER — it lives in its own
 * localStorage key, outside the save file, so it survives wipes and new games.
 */
import type { GameEvent, HeroLifetimeSnapshot } from '../game/types';

export interface GraveRecord {
  name: string;
  classId: string;
  level: number;
  depth: number;
  diedAtMs: number;
  /** how it happened and who did it */
  cause?: string;
  /** lifetime stats snapshot captured at death (graves from before this update lack it) */
  lifetime?: HeroLifetimeSnapshot;
}

const KEY = 'idc:graveyard';
const MAX_GRAVES = 500;

export function loadGraveyard(): GraveRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordFallen(events: GameEvent[], nowMs: number): boolean {
  const deaths = events.filter((e) => e.t === 'heroDied');
  if (deaths.length === 0) return false;
  const graves = loadGraveyard();
  for (const e of deaths) {
    if (e.t !== 'heroDied') continue;
    graves.push({ name: e.name, classId: e.classId, level: e.level, depth: e.depth, diedAtMs: nowMs, cause: e.cause, lifetime: e.lifetime });
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(graves.slice(-MAX_GRAVES)));
  } catch {
    // a full disk shall not crash the funeral
  }
  return true;
}

const EPITAPHS = [
  'Told everyone it was "probably not a mimic".',
  'Should have withdrawn.',
  'Died as they lived: slightly too far from the healer.',
  'The chicken saw everything.',
  'Read the tactics. Ignored the tactics.',
  '"I know a shortcut."',
  'Went back for the chest.',
  'Bravely held the doorway. The doorway won.',
  'Owed the tavern 12 gold.',
  'At least the boots survived.',
  'Asked the skeleton if it was friendly.',
  'The fireball was, in retrospect, theirs.',
  'Never did learn to swim in armor.',
  'Last words: "what does taunt do?"',
  'Buried with their favorite spoon.',
];

/** stable, name-derived epitaph so each grave keeps its joke forever */
export function epitaphFor(record: GraveRecord): string {
  let h = 0;
  const key = record.name + record.diedAtMs;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return EPITAPHS[h % EPITAPHS.length]!;
}
