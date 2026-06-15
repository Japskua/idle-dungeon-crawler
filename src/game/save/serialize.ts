/**
 * Save serialization. GameState is plain data except Uint8Array tile buffers,
 * encoded as { __u8: base64 }. Includes a tiny checksum'd export-string format.
 */
import type { GameState } from '../types';
import { SAVE_VERSION } from '../newGame';
import { ITEMS } from '../content';
import { defaultTactics } from '../tactics/defaults';
import { TRAIT_IDS, emptyStats } from '../hero/create';

function u8ToBase64(u8: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state, (_key, value) => {
    if (value instanceof Uint8Array) return { __u8: u8ToBase64(value) };
    return value;
  });
}

export function deserialize(text: string): GameState {
  const state = JSON.parse(text, (_key, value) => {
    if (value && typeof value === 'object' && typeof value.__u8 === 'string') {
      return base64ToU8(value.__u8);
    }
    return value;
  }) as GameState;
  return migrate(state);
}

/** ordered migrations; index i migrates v=i+1 -> v=i+2 */
const MIGRATIONS: ((state: any) => any)[] = [
  // v1 -> v2: party-shared loot/gold became per-hero (gold + satchel).
  (s: any) => {
    for (const id of s.rosterOrder ?? []) {
      const h = s.roster?.[id];
      if (!h) continue;
      if (typeof h.gold !== 'number') h.gold = 0;
      if (!Array.isArray(h.satchel)) h.satchel = [];
      if (h.stats && typeof h.stats.runGold !== 'number') h.stats.runGold = 0;
    }
    // an in-progress v1 run still has party.goldCarried + party.lootBag; disperse
    // them to the standing members deterministically so no haul is lost.
    if (s.run?.party) {
      const p = s.run.party;
      const standing = (p.memberIds ?? []).filter((m: string) => !(p.downed && m in p.downed));
      const recipients = standing.length ? standing : (p.memberIds ?? []);
      const g = p.goldCarried ?? 0;
      const per = recipients.length ? Math.floor(g / recipients.length) : 0;
      recipients.forEach((m: string, i: number) => {
        const h = s.roster?.[m];
        if (!h) return;
        const add = per + (i === 0 ? g - per * recipients.length : 0);
        h.gold = (h.gold ?? 0) + add;
        if (h.stats) h.stats.runGold = (h.stats.runGold ?? 0) + add;
      });
      const first = recipients[0] && s.roster?.[recipients[0]];
      for (const it of p.lootBag ?? []) if (first) first.satchel.push(it);
      delete p.goldCarried;
      delete p.lootBag;
    }
    return s;
  },
];

export function migrate(state: GameState): GameState {
  let s: any = state;
  while (s.v < SAVE_VERSION) {
    const step = MIGRATIONS[s.v - 1];
    if (!step) throw new Error(`no migration from save v${s.v}`);
    s = step(s);
    s.v++;
  }
  reconcileContent(s);
  return s as GameState;
}

/** drop references to content that no longer exists (JSON files are user-editable) */
function reconcileContent(state: GameState) {
  if (typeof (state.village as { bombs?: number }).bombs !== 'number') state.village.bombs = 0;
  const refund = (defId: string) => {
    state.village.gold += Math.round((ITEMS[defId]?.value ?? 0) * 0.4);
  };
  state.village.inventory = state.village.inventory.filter((item) => {
    if (ITEMS[item.defId]) return true;
    refund(item.defId);
    return false;
  });
  for (const id of state.rosterOrder) {
    const hero = state.roster[id];
    if (!hero) continue;
    for (const slot of ['weapon', 'offhand', 'armor', 'trinket'] as const) {
      const item = hero.equipment[slot];
      if (item && !ITEMS[item.defId]) delete hero.equipment[slot];
    }
    // heroes saved before the tactics system (or with all sets deleted) get class defaults
    if (!hero.tactics || hero.tactics.sets.length === 0 || hero.tactics.sets.every((s) => s.rules.length === 0)) {
      hero.tactics = { sets: defaultTactics(hero.classId), activeSetId: 'default' };
    }
    // heroes saved before lifetime statistics get a blank story arc
    if (!hero.stats) hero.stats = emptyStats();
    if (typeof hero.bombs !== 'number') hero.bombs = 0;
    if (typeof hero.gold !== 'number') hero.gold = 0;
    if (!Array.isArray(hero.satchel)) hero.satchel = [];
    if (hero.stats && typeof hero.stats.runGold !== 'number') hero.stats.runGold = 0;
    hero.satchel = hero.satchel.filter((it: { defId: string }) => {
      if (ITEMS[it.defId]) return true;
      hero.gold += Math.round((ITEMS[it.defId]?.value ?? 0) * 0.4);
      return false;
    });
    if (!Array.isArray(hero.traits) || hero.traits.length === 0) {
      // pre-banter heroes get a stable personality from their id, no rng burned
      let h = 0x811c9dc5;
      for (let i = 0; i < hero.id.length; i++) {
        h ^= hero.id.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      h = h >>> 0;
      const a = h % TRAIT_IDS.length;
      const b = (a + 1 + ((h >>> 8) % (TRAIT_IDS.length - 1))) % TRAIT_IDS.length;
      hero.traits = [TRAIT_IDS[a]!, TRAIT_IDS[b]!];
    }
  }
  if (state.run) {
    state.run.groundLoot = state.run.groundLoot.filter((g) => ITEMS[g.item.defId]);
  }
}

function checksum(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const EXPORT_PREFIX = 'IDC1';

export function exportSave(state: GameState): string {
  const json = serialize(state);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return `${EXPORT_PREFIX}.${checksum(b64)}.${b64}`;
}

export function importSave(text: string): GameState {
  const parts = text.trim().split('.');
  if (parts.length !== 3 || parts[0] !== EXPORT_PREFIX) throw new Error('not a valid save string');
  if (checksum(parts[2]!) !== parts[1]) throw new Error('save string is corrupted (checksum mismatch)');
  const json = decodeURIComponent(escape(atob(parts[2]!)));
  return deserialize(json);
}
