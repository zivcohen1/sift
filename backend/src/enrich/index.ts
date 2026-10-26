import { loadKnowledgeBase } from "../refdata";
import type { AmbiguousItem, CategoryHit, KnowledgeBase, ProductFacts } from "../types";
import { findAmbiguous } from "./ambiguous";
import { matchCategory } from "./categories";
import { flattenNodes, parseIngredientStatement } from "./ingredients";

/** Keep one hit per (category, ingredient), preferring a definite hit over a possible one. */
function dedupeHits(hits: CategoryHit[]): CategoryHit[] {
  const best = new Map<string, CategoryHit>();
  for (const hit of hits) {
    const key = `${hit.categoryId}|${hit.ingredient.toLowerCase()}`;
    const current = best.get(key);
    if (!current || (current.certainty === "possible" && hit.certainty === "definite")) best.set(key, hit);
  }
  return [...best.values()];
}

/**
 * Turn an ingredient statement into ProductFacts. Every source (barcode database or
 * photographed label) goes through this one function, so all products are judged alike.
 */
export function buildProductFacts(ingredientText: string, kb: KnowledgeBase = loadKnowledgeBase()): ProductFacts {
  const nodes = flattenNodes(parseIngredientStatement(ingredientText));
  const hits: CategoryHit[] = [];
  const ambiguous = new Map<string, AmbiguousItem>();

  for (const node of nodes) {
    const fromMayContain = node.statement === "may_contain";

    for (const cat of kb.categories) {
      const m = matchCategory(node.text, cat);
      if (!m) continue;
      // A "May contain" statement can only ever be a possible hit.
      const certainty = fromMayContain ? "possible" : m.certainty;
      hits.push({ categoryId: cat.id, term: m.term, certainty, ingredient: node.text, fromMayContain });
    }
    for (const item of findAmbiguous(node.text, kb.ambiguous)) ambiguous.set(item.name, item);
  }

  // Implied categories: every wheat hit is also a gluten hit.
  for (const cat of kb.categories) {
    for (const hit of hits.filter((h) => cat.impliedBy.includes(h.categoryId))) {
      hits.push({ ...hit, categoryId: cat.id, impliedBy: hit.categoryId });
    }
  }

  const unique = (xs: string[]) => [...new Set(xs)];
  return {
    ingredients: unique(nodes.filter((n) => n.statement === "ingredients").map((n) => n.text)),
    mayContain: unique(nodes.filter((n) => n.statement === "may_contain").map((n) => n.text)),
    hasIngredients: nodes.some((n) => n.statement === "ingredients"),
    categoryHits: dedupeHits(hits),
    ambiguous: [...ambiguous.values()],
    kbVersion: kb.version,
  };
}

export * from "./ingredients";
export * from "./categories";
export * from "./ambiguous";
export * from "./religious";
export * from "./fromSource";
