import { ingredientDataQuality } from "../../backend/src/enrich/quality";
import type { EnrichedProduct, ProductInfo } from "./types";

/** Also checks raw fields so older deployed APIs receive the same warning. */
export function checkIngredientData(product: ProductInfo, enriched: EnrichedProduct) {
  const quality = ingredientDataQuality({
    ingredientsText: product.ingredientsText ?? enriched.facts.ingredients.join(", "),
    allergenTags: product.allergenTags,
  });
  return {
    ...quality,
    hasConflict: quality.hasConflict || enriched.warnings.includes("ingredient_data_conflict"),
  };
}
