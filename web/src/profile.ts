/**
 * The user's restrictions. Stored only in this browser (see storage.ts).
 * This replaces SwiftData from the iOS design: same idea, health data stays on the device.
 */
import { HALAL_AGENCIES, KOSHER_AGENCIES } from "./reference";
import { readJson, removeKey, writeJson, type KeyValueStore } from "./storage";

export interface SchemePreference {
  on: boolean;
  /** Agency ids the user trusts, e.g. ["ou", "star-k"]. */
  accepted: string[];
}

export interface Profile {
  version: 1;
  /** Category ids to avoid, e.g. ["dairy", "gluten"]. */
  avoid: string[];
  kosher: SchemePreference;
  halal: SchemePreference;
  /** What "may contain" and doubtful items mean for this user. */
  doubtfulPolicy: "caution" | "avoid";
}

export const DEFAULT_PROFILE: Profile = {
  version: 1,
  avoid: [],
  kosher: { on: false, accepted: KOSHER_AGENCIES.map((a) => a.id) },
  halal: { on: false, accepted: HALAL_AGENCIES.map((a) => a.id) },
  doubtfulPolicy: "caution",
};

const KEY = "sift.profile.v1";

export function loadProfile(store?: KeyValueStore | null): Profile {
  const saved = readJson<Partial<Profile> | null>(KEY, null, store ?? undefined);
  if (!saved || saved.version !== 1) return structuredClone(DEFAULT_PROFILE);
  // Fill in anything a newer version of the app added.
  return {
    ...structuredClone(DEFAULT_PROFILE),
    ...saved,
    kosher: { ...DEFAULT_PROFILE.kosher, ...saved.kosher },
    halal: { ...DEFAULT_PROFILE.halal, ...saved.halal },
  };
}

export function saveProfile(profile: Profile, store?: KeyValueStore | null): boolean {
  return writeJson(KEY, profile, store ?? undefined);
}

export function eraseProfile(store?: KeyValueStore | null): void {
  removeKey(KEY, store ?? undefined);
}

export function hasRestrictions(p: Profile): boolean {
  return p.avoid.length > 0 || p.kosher.on || p.halal.on;
}

export function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
