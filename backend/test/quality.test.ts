import { describe, expect, it } from "vitest";
import { ingredientDataQuality } from "../src/enrich/quality";
import { enrichProduct } from "../src/enrich/fromSource";

describe("ingredient data quality", () => {
  it("flags the observed truncated spread record without inventing ingredients", () => {
    const src = { ingredientsText: "sugar, palm oil", allergenTags: ["en:milk", "en:nuts", "en:soybeans"], nutrition: null };
    const quality = ingredientDataQuality(src);
    expect(quality.hasConflict).toBe(true);
    expect(quality.unlistedAllergens).toEqual(["milk", "nuts", "soybeans"]);
    const enriched = enrichProduct(src, "open_food_facts");
    expect(enriched.warnings).toContain("ingredient_data_conflict");
    expect(enriched.facts.ingredients).toEqual(["sugar", "palm oil"]);
    expect(enriched.facts.categoryHits.some((hit) => hit.categoryId === "dairy")).toBe(true);
  });

  it("allows legitimate short lists, synonyms, and implied gluten", () => {
    expect(ingredientDataQuality({ ingredientsText: "salt" }).hasConflict).toBe(false);
    expect(ingredientDataQuality({ ingredientsText: "whey, wheat flour", allergenTags: ["en:milk", "en:gluten"] }).hasConflict).toBe(false);
  });

  it("does not let may-contain or contains clauses conceal missing ingredient evidence", () => {
    expect(ingredientDataQuality({ ingredientsText: "sugar. May contain milk.", allergenTags: ["en:milk"] }).hasConflict).toBe(true);
    expect(ingredientDataQuality({ ingredientsText: "sugar. Contains milk.", allergenTags: ["en:milk"] }).hasConflict).toBe(true);
  });

  it("handles missing lists separately and does not guess unknown allergens", () => {
    expect(ingredientDataQuality({ allergenTags: ["en:milk"] })).toMatchObject({ hasIngredientList: false, hasConflict: false });
    expect(ingredientDataQuality({ ingredientsText: "salt", allergenTags: ["en:unknown"] }).hasConflict).toBe(false);
  });
});
