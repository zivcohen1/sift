import { describe, expect, it } from "vitest";
import { collectCertifications, enrichProduct, type SourceProductLike } from "../src/enrich";

// Sample shaped like the Open Food Facts reader's FoodProduct (illustrative data, not a real record).
const off = {
  ingredientsText: "Sugar, palm oil, hazelnuts 13%, skim milk powder 8.7%, emulsifiers: lecithins (soy)",
  labelsText: "Kosher, OU-D",
  labelTags: ["en:kosher", "en:ou-kosher"],
  traceTags: ["en:nuts"],
  allergenTags: ["en:milk", "en:nuts", "en:soybeans"],
  nutrition: { basis: "per_100g", values: { sugars_g: 56.3, sodium_mg: 41 } },
} satisfies SourceProductLike;

// Sample shaped like the USDA reader's UsdaProduct (no tags at all).
const usda = {
  ingredientsText: "ENRICHED WHEAT FLOUR (WHEAT FLOUR, NIACIN), SUGAR, CONTAINS 2% OR LESS OF: SALT",
  nutrition: { basis: "per_100g", values: { sodium_mg: 420 } },
} satisfies SourceProductLike;

describe("enrichProduct (Open Food Facts shape)", () => {
  const e = enrichProduct(off, "open_food_facts");

  it("finds categories in the ingredient list", () => {
    const ids = e.facts.categoryHits.map((h) => h.categoryId);
    expect(ids).toContain("tree_nut");
    expect(ids).toContain("dairy");
  });
  it("passes nutrition through for the RuleEngine's nutrient limits", () => {
    expect(e.nutrientsPer100g.sodium_mg).toBe(41);
  });
  it("treats trace tags as possible, never definite", () => {
    expect(e.facts.mayContain).toContain("nuts");
    expect(e.facts.categoryHits.filter((h) => h.fromMayContain).every((h) => h.certainty === "possible")).toBe(true);
  });
  it("is kosher-certified by a named agency and not generic claims alone", () => {
    expect(e.religious.kosher.status).toBe("certified");
    expect(e.religious.halal.status).toBe("no_listed_conflicts");
  });
  it("warns that crowd-sourced data needs the package check", () => {
    expect(e.warnings).toContain("crowd_sourced_check_the_package");
  });
});

describe("enrichProduct (USDA shape)", () => {
  const e = enrichProduct(usda, "usda");

  it("handles upper-case statements and 'contains 2% or less of'", () => {
    expect(e.facts.hasIngredients).toBe(true);
    expect(e.facts.ingredients).toContain("SALT");
    expect(e.facts.categoryHits.some((h) => h.categoryId === "wheat" && h.certainty === "definite")).toBe(true);
    expect(e.facts.categoryHits.some((h) => h.categoryId === "gluten")).toBe(true);
  });
  it("never assumes kosher without evidence", () => {
    expect(e.religious.kosher.status).toBe("not_certified");
  });
  it("does not add the crowd-sourced warning for USDA", () => {
    expect(e.warnings).not.toContain("crowd_sourced_check_the_package");
  });
});

describe("edge cases", () => {
  it("flags a missing ingredient list and missing nutrition", () => {
    const e = enrichProduct({ nutrition: null }, "open_food_facts");
    expect(e.facts.hasIngredients).toBe(false);
    expect(e.warnings).toEqual(expect.arrayContaining(["no_ingredient_list", "no_nutrition_data"]));
    expect(e.religious.halal.status).toBe("insufficient_data");
  });
  it("reports certification plus a forbidden ingredient as conflicting data", () => {
    const e = enrichProduct({ ingredientsText: "pork, salt", labelTags: ["en:ou-kosher"], nutrition: null }, "open_food_facts");
    expect(e.religious.kosher.status).toBe("conflicting_data");
  });
  it("breaks kosher law for meat with dairy even when certified-looking", () => {
    const e = enrichProduct({ ingredientsText: "beef, cheese", nutrition: null }, "usda");
    expect(e.religious.kosher.status).toBe("forbidden_ingredient");
  });
  it("treats a generic kosher tag as low confidence", () => {
    expect(collectCertifications({ labelTags: ["en:kosher"], nutrition: null }, "kosher")).toEqual([
      { agencyId: null, agencyName: "kosher claim", confidence: "low" },
    ]);
  });
  it("reads an agency mark from free label text", () => {
    expect(collectCertifications({ labelsText: "Gluten-free, OU-P", nutrition: null }, "kosher")[0]?.agencyId).toBe("ou");
  });
});
