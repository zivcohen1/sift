import { describe, expect, it } from "vitest";
import sample from "../../contracts/enriched_sample.json";
import { checkIngredientData } from "./ingredientData";
import { DEFAULT_PROFILE } from "./profile";
import { decideVerdict } from "./ruleEngine";
import type { EnrichedProduct } from "./types";

const SAMPLE = sample as unknown as EnrichedProduct;

describe("incomplete ingredient data", () => {
  it("detects the legacy API record and prevents a green verdict", () => {
    const quality = checkIngredientData({ ingredientsText: "sugar, palm oil", allergenTags: ["en:milk", "en:nuts"] }, SAMPLE);
    expect(quality.hasConflict).toBe(true);
    const verdict = decideVerdict(SAMPLE, DEFAULT_PROFILE, quality.hasConflict);
    expect(verdict.level).toBe("not_sure");
    expect(verdict.findings[0]?.title).toBe("Ingredient data may be incomplete");
  });

  it("honors a backend warning even if raw source fields are absent", () => {
    const enriched = structuredClone(SAMPLE);
    enriched.warnings.push("ingredient_data_conflict");
    expect(checkIngredientData({}, enriched).hasConflict).toBe(true);
    expect(decideVerdict(enriched, DEFAULT_PROFILE).level).toBe("not_sure");
  });

  it("keeps a definite restriction conflict above uncertain data", () => {
    expect(decideVerdict(SAMPLE, { ...DEFAULT_PROFILE, avoid: ["dairy"] }, true).level).toBe("avoid");
  });

  it("does not treat a short list alone as incomplete", () => {
    expect(checkIngredientData({ ingredientsText: "salt" }, SAMPLE).hasConflict).toBe(false);
  });
});
