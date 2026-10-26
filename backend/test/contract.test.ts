import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { enrichProduct } from "../src/enrich/fromSource";

/**
 * The Worker's JSON is the contract with the iPhone app. This sample is enriched here and
 * compared with contracts/enriched_sample.json, which the Swift tests decode. If the
 * output shape changes on purpose, regenerate with:  UPDATE_CONTRACT=1 npx vitest run
 * then re-run `swift test` in ios/SiftCore.
 */
export const SAMPLE = {
  ingredientsText:
    "Enriched wheat flour, sugar, whey, natural flavor, bacon bits, salt. May contain tree nuts.",
  labelsText: "",
  labelTags: [] as string[],
  traceTags: [] as string[],
  allergenTags: ["en:gluten", "en:milk"],
  nutrition: { basis: "per_100g" as const, values: { sodium_mg: 600, sugar_g: 12 } },
};

const FIXTURE = resolve(__dirname, "../../contracts/enriched_sample.json");

describe("Worker to app JSON contract", () => {
  const actual = JSON.parse(JSON.stringify(enrichProduct(SAMPLE, "open_food_facts")));

  it("matches the checked-in fixture the Swift tests decode", () => {
    if (process.env.UPDATE_CONTRACT || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + "\n");
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });

  it("exercises the cases the app must handle", () => {
    expect(actual.facts.categoryHits.some((h: { categoryId: string }) => h.categoryId === "wheat")).toBe(true);
    expect(actual.facts.categoryHits.some((h: { fromMayContain: boolean }) => h.fromMayContain)).toBe(true);
    expect(actual.facts.ambiguous.length).toBeGreaterThan(0);
    expect(actual.religious.kosher.status).toBe("forbidden_ingredient");
  });
});
