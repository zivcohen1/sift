/** Keep the original manually saved history as favorites, preserving existing saves. */
import { readJson, removeKey, writeJson, type KeyValueStore } from "./storage";
import type { HistoryEntry } from "./history";

const KEY = "sift.history.v1";

export function loadFavorites(store?: KeyValueStore | null): HistoryEntry[] {
  const list = readJson<HistoryEntry[]>(KEY, [], store ?? undefined);
  return Array.isArray(list) ? list : [];
}

export function addToFavorites(entry: HistoryEntry, store?: KeyValueStore | null): HistoryEntry[] {
  const list = [entry, ...loadFavorites(store).filter((e) => e.barcode !== entry.barcode)];
  writeJson(KEY, list, store ?? undefined);
  return list;
}

export function clearFavorites(store?: KeyValueStore | null): void {
  removeKey(KEY, store ?? undefined);
}
