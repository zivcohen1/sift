/**
 * The user's data lives only in this browser (localStorage), never on a server.
 * Every read and write is wrapped: private browsing or blocked storage must not break the app.
 * All access goes through these two functions, so moving to IndexedDB later is a one-file change.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, fallback: T, store = defaultStore()): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, store = defaultStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string, store = defaultStore()): void {
  try {
    store?.removeItem(key);
  } catch {
    /* nothing to do */
  }
}
