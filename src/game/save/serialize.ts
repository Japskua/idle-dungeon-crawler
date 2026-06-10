/**
 * Save serialization. GameState is plain data except Uint8Array tile buffers,
 * encoded as { __u8: base64 }. Includes a tiny checksum'd export-string format.
 */
import type { GameState } from '../types';
import { SAVE_VERSION } from '../newGame';
import { ITEMS } from '../content';

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
const MIGRATIONS: ((state: any) => any)[] = [];

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
  }
  if (state.run) {
    state.run.party.lootBag = state.run.party.lootBag.filter((i) => ITEMS[i.defId]);
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
