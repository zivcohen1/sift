/** Saved scans ("Library"). Kept only in this browser, newest first, at most 50. */
import { readJson, removeKey, writeJson, type KeyValueStore } from "./storage";
import type { Level } from "./ruleEngine";

export interface HistoryEntry {
  barcode: string;
  name?: string;
  brand?: string;
  level: Level;
  headline: string;
  savedAt: string; // ISO date
}

const KEY = "sift.history.v1";
const MAX = 50;

export function loadHistory(store?: KeyValueStore | null): HistoryEntry[] {
  const list = readJson<HistoryEntry[]>(KEY, [], store ?? undefined);
  return Array.isArray(list) ? list : [];
}

/** Adds an entry (replacing an older one for the same barcode) and returns the new list. */
export function addToHistory(entry: HistoryEntry, store?: KeyValueStore | null): HistoryEntry[] {
  const list = [entry, ...loadHistory(store).filter((e) => e.barcode !== entry.barcode)].slice(0, MAX);
  writeJson(KEY, list, store ?? undefined);
  return list;
}

export function clearHistory(store?: KeyValueStore | null): void {
  removeKey(KEY, store ?? undefined);
}
