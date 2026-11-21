import { loadKnowledgeBase } from "../refdata";
import type { KnowledgeBase } from "../types";
import { matchCategory } from "./categories";
import { flattenNodes, parseIngredientStatement } from "./ingredients";

interface IngredientSource {
  ingredientsText?: string;
  allergenTags?: string[];
}

export const allergenLabel = (tag: string): string => tag.replace(/^[a-z]{2}:/, "").replace(/-/g, " ");

/** Detect inconsistent evidence, not completeness: short lists can be legitimate.
 * Only allergens recognized by the knowledge base can be compared reliably.
 */
export function ingredientDataQuality(src: IngredientSource, kb: KnowledgeBase = loadKnowledgeBase()) {
  const ingredients = flattenNodes(parseIngredientStatement(src.ingredientsText ?? ""))
    .filter((node) => node.statement === "ingredients");
  const hasIngredientList = ingredients.length > 0;
  const listed = new Set(kb.categories.filter((category) => ingredients.some(
    (node) => matchCategory(node.text, category)?.certainty === "definite",
  )).map((category) => category.id));
  for (const category of kb.categories) {
    if (category.impliedBy.some((id) => listed.has(id))) listed.add(category.id);
  }
  const unlistedAllergens = (src.allergenTags ?? []).map(allergenLabel).filter((allergen) => {
    const categories = kb.categories.filter((category) => matchCategory(allergen, category)?.certainty === "definite");
    return categories.length > 0 && categories.some((category) => !listed.has(category.id));
  });
  return {
    hasIngredientList,
    // A missing list is handled separately; do not call it a contradictory list.
    hasConflict: hasIngredientList && unlistedAllergens.length > 0,
    unlistedAllergens: [...new Set(unlistedAllergens)],
  };
}
