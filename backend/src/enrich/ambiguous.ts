import { cachedTermRegex, normalizeText } from "../refdata";
import type { AmbiguousDef, AmbiguousItem } from "../types";

/**
 * Find ingredients that might break a rule but cannot be settled from the dictionary.
 * A qualifier such as "fish gelatin" settles the question, so it is not reported.
 */
export function findAmbiguous(text: string, defs: AmbiguousDef[]): AmbiguousItem[] {
  const s = normalizeText(text);
  const items: AmbiguousItem[] = [];
  for (const def of defs) {
    if (!cachedTermRegex(def.term).test(s)) continue;
    if (def.qualifiers.some((q) => cachedTermRegex(q).test(s))) continue;
    items.push({ name: def.term, ingredient: text, mightBelongTo: def.mightBelongTo });
  }
  return items;
}
