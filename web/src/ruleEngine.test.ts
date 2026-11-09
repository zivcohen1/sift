import { describe, expect, it } from "vitest";
import sample from "../../contracts/enriched_sample.json";
import { DEFAULT_PROFILE, type Profile } from "./profile";
import { decideVerdict, ingredientTag } from "./ruleEngine";
import type { EnrichedProduct } from "./types";

// contracts/enriched_sample.json is the API's own example output (kept in sync by the backend tests).
const SAMPLE = sample as unknown as EnrichedProduct;
const profile = (p: Partial<Profile>): Profile => ({ ...structuredClone(DEFAULT_PROFILE), ...p });

describe("decideVerdict with the contract sample", () => {
  it("avoids dairy and names every dairy ingredient", () => {
    const v = decideVerdict(SAMPLE, profile({ avoid: ["dairy"] }));
    expect(v.level).toBe("avoid");
    expect(v.findings[0]).toMatchObject({ title: "Contains dairy", level: "avoid" });
    expect(v.findings[0]!.detail).toContain('"whey"');
  });

  it("'may contain' is caution by default and avoid for strict users", () => {
    expect(decideVerdict(SAMPLE, profile({ avoid: ["tree_nut"] })).level).toBe("caution");
    expect(decideVerdict(SAMPLE, profile({ avoid: ["tree_nut"], doubtfulPolicy: "avoid" })).level).toBe("avoid");
  });

  it("an unexplained ingredient that could break a rule is Not Sure, never Good", () => {
    // Remove the bacon so only "natural flavor" could involve meat.
    const noBacon: EnrichedProduct = structuredClone(SAMPLE);
    noBacon.facts.categoryHits = noBacon.facts.categoryHits.filter((h) => h.categoryId !== "meat");
    const v = decideVerdict(noBacon, profile({ avoid: ["meat"] }));
    expect(v.level).toBe("not_sure");
    expect(v.findings[0]!.title).toBe("Can't tell about natural flavor");
  });

  it("still flags natural flavor as unclear, below the confirmed Avoid", () => {
    const v = decideVerdict(SAMPLE, profile({ avoid: ["dairy"] }));
    expect(v.findings.map((f) => f.level)).toEqual(["avoid", "not_sure"]);
  });

  it("is Good (no listed conflicts) for an unrelated restriction", () => {
    const v = decideVerdict(SAMPLE, profile({ avoid: ["phosphate_additives"] }));
    expect(v.level).toBe("good");
    expect(v.findings).toEqual([]);
  });

  it("uses the API's kosher decision", () => {
    const v = decideVerdict(SAMPLE, profile({ kosher: { on: true, accepted: ["ou"] } }));
    expect(v.level).toBe("avoid");
    expect(v.findings[0]).toMatchObject({ title: "Conflicts with kosher rules", source: "kosher" });
  });

  it("never says Good without an ingredient list", () => {
    const empty: EnrichedProduct = structuredClone(SAMPLE);
    empty.facts = { ...empty.facts, hasIngredients: false, ingredients: [], categoryHits: [], ambiguous: [] };
    expect(decideVerdict(empty, profile({})).level).toBe("not_sure");
  });
});

describe("certified products", () => {
  const certified = (agencyId: string, agencyName: string): EnrichedProduct => {
    const e: EnrichedProduct = structuredClone(SAMPLE);
    e.facts.categoryHits = [];
    e.facts.ambiguous = [];
    e.religious.kosher = {
      scheme: "kosher",
      status: "certified",
      certifications: [{ agencyId, agencyName, confidence: "medium" }],
      concerns: [],
      summary: `Certification found: ${agencyName}.`,
    };
    return e;
  };

  it("is Good when the certifier is one the user accepts", () => {
    const v = decideVerdict(certified("ou", "OU"), profile({ kosher: { on: true, accepted: ["ou"] } }));
    expect(v.level).toBe("good");
    expect(v.findings[0]!.title).toBe("Kosher: certified by OU");
  });

  it("is Caution when the certifier is not on the user's list", () => {
    const v = decideVerdict(certified("kof-k", "Kof-K"), profile({ kosher: { on: true, accepted: ["ou"] } }));
    expect(v.level).toBe("caution");
    expect(v.findings[0]!.detail).toContain("You accept: OU");
  });
});

describe("ingredientTag", () => {
  it("labels each ingredient row", () => {
    const v = decideVerdict(SAMPLE, profile({ avoid: ["dairy", "meat"] }));
    expect(ingredientTag("whey", v)).toEqual({ text: "Dairy", level: "avoid" });
    expect(ingredientTag("sugar", v)).toEqual({ text: "OK", level: "good" });
    expect(ingredientTag("natural flavor", v)).toEqual({ text: "Check", level: "not_sure" });
  });

  it("marks kosher concerns on the row that contains them", () => {
    const v = decideVerdict(SAMPLE, profile({ kosher: { on: true, accepted: ["ou"] } }));
    expect(ingredientTag("bacon bits", v)).toEqual({ text: "Not kosher", level: "avoid" });
    expect(ingredientTag("natural flavor", v)).toEqual({ text: "Check", level: "caution" });
    expect(ingredientTag("salt", v)).toEqual({ text: "OK", level: "good" });
  });

  it("matches whole words only", () => {
    const v = decideVerdict(SAMPLE, profile({ kosher: { on: true, accepted: ["ou"] } }));
    expect(ingredientTag("baconnaise-free spread", v).text).toBe("OK");
  });
});
