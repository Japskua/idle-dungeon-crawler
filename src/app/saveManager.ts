/**
 * Dual-slot localStorage persistence: writes alternate between two slots with
 * a meta pointer, so a quota error or tab kill mid-write never corrupts the
 * only copy. The sim never touches storage — only this file does.
 */
import type { GameState } from '../game/types';
import { deserialize, serialize } from '../game/save/serialize';

const KEY_A = 'idc:save:a';
const KEY_B = 'idc:save:b';
const KEY_META = 'idc:save:meta';

export function loadGame(): GameState | null {
  const meta = localStorage.getItem(KEY_META);
  const order = meta === 'b' ? [KEY_B, KEY_A] : [KEY_A, KEY_B];
  for (const key of order) {
    const text = localStorage.getItem(key);
    if (!text) continue;
    try {
      return deserialize(text);
    } catch (e) {
      console.warn(`save slot ${key} unreadable, trying the other slot`, e);
    }
  }
  return null;
}

export function saveGame(state: GameState): boolean {
  state.savedAtMs = Date.now();
  const text = serialize(state);
  const current = localStorage.getItem(KEY_META) === 'b' ? 'b' : 'a';
  const next = current === 'a' ? 'b' : 'a';
  try {
    localStorage.setItem(next === 'a' ? KEY_A : KEY_B, text);
    localStorage.setItem(KEY_META, next);
    return true;
  } catch (e) {
    console.error('saving failed', e);
    return false;
  }
}

export function wipeSave() {
  localStorage.removeItem(KEY_A);
  localStorage.removeItem(KEY_B);
  localStorage.removeItem(KEY_META);
}
