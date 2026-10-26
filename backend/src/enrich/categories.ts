import { cachedTermRegex, normalizeText } from "../refdata";
import type { CategoryDef, Certainty } from "../types";

const E_NUMBER_RE = /\be[\s-]?(\d{3,4}[a-z]?)\b/gi;

/** Remove the category's exclusion phrases, e.g. "cocoa butter" for dairy. */
export function stripExcluded(text: string, cat: CategoryDef): string {
  let s = text;
  for (const phrase of cat.excludePhrases) {
    const re = cachedTermRegex(normalizeText(phrase));
    s = s.replace(new RegExp(re.source, "gi"), " ");
  }
  return s;
}

/**
 * Match one ingredient against one category.
 * Order: definite terms, E-numbers, then possible terms. First hit wins.
 */
export function matchCategory(
  text: string,
  cat: CategoryDef,
): { term: string; certainty: Certainty } | null {
  const s = stripExcluded(normalizeText(text), cat);

  for (const term of cat.terms) {
    if (cachedTermRegex(term).test(s)) return { term, certainty: "definite" };
  }
  if (cat.eNumbers.length) {
    for (const m of s.matchAll(E_NUMBER_RE)) {
      const code = `E${(m[1] ?? "").toUpperCase()}`;
      if (cat.eNumbers.includes(code)) return { term: code, certainty: "definite" };
    }
  }
  for (const term of cat.possibleTerms) {
    if (cachedTermRegex(term).test(s)) return { term, certainty: "possible" };
  }
  return null;
}
