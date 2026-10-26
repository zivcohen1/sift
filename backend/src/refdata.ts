import categories from "../data/categories.json";
import ambiguous from "../data/ambiguous.json";
import religiousRules from "../data/religious_rules.json";
import type { CategoryDef, AmbiguousDef, KnowledgeBase, ReligiousRule } from "./types";

export const KB_VERSION = "0.1.0";

export function loadKnowledgeBase(): KnowledgeBase {
  return {
    version: KB_VERSION,
    categories: categories as CategoryDef[],
    ambiguous: ambiguous as AmbiguousDef[],
    religiousRules: religiousRules as ReligiousRule[],
  };
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase, strip accents and curly quotes, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whole-word, plural-tolerant matcher. Separators (spaces, hyphens) may vary,
 * so "graham" never matches "ham" and "tree nut" matches "tree-nuts".
 */
export function termRegex(term: string): RegExp {
  const body = escapeRegExp(term.toLowerCase()).replace(/[-\s]+/g, "[\\s-]+");
  return new RegExp(`(?<![\\w])${body}(?:e?s)?(?![\\w])`, "i");
}

const cache = new Map<string, RegExp>();

/** Compiled regexes are cached, so matching never recompiles a pattern. */
export function cachedTermRegex(term: string): RegExp {
  let re = cache.get(term);
  if (!re) {
    re = termRegex(term);
    cache.set(term, re);
  }
  return re;
}
