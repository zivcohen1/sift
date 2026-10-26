import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../src/refdata";
import {
  assessReligious, buildProductFacts, findConcerns, meatDairyConcern, parseKosherMark,
  type Certification,
} from "../src/enrich";

const kb = loadKnowledgeBase();
const ou: Certification = { agencyId: "ou", agencyName: "OU", confidence: "high" };
const generic: Certification = { agencyId: null, agencyName: "kosher claim", confidence: "low" };

const status = (scheme: "kosher" | "halal", ingredients: string[], certs: Certification[] = [], has = true) =>
  assessReligious({
    scheme, certifications: certs, hasIngredients: has,
    concerns: findConcerns(ingredients, scheme, kb.religiousRules),
  }).status;

describe("assessReligious status order", () => {
  it("flags certification plus a forbidden ingredient as conflicting", () => {
    expect(status("kosher", ["pork"], [ou])).toBe("conflicting_data");
  });
  it("flags a forbidden ingredient alone", () => {
    expect(status("halal", ["pork"])).toBe("forbidden_ingredient");
  });
  it("accepts a trusted certification", () => {
    expect(status("kosher", ["sugar"], [ou])).toBe("certified");
  });
  it("does not trust a generic claim", () => {
    expect(status("kosher", ["sugar"], [generic])).toBe("not_certified");
  });
  it("needs an ingredient list", () => {
    expect(status("halal", [], [], false)).toBe("insufficient_data");
  });
  it("is doubtful for halal with doubtful ingredients", () => {
    expect(status("halal", ["gelatin"])).toBe("doubtful_ingredient");
  });
  it("never assumes kosher without certification", () => {
    expect(status("kosher", ["sugar"])).toBe("not_certified");
  });
  it("reports no listed conflicts for clean halal products, never 'safe'", () => {
    const a = assessReligious({ scheme: "halal", concerns: [], certifications: [], hasIngredients: true });
    expect(a.status).toBe("no_listed_conflicts");
    expect(a.summary.toLowerCase()).not.toContain("safe");
  });
});

describe("findConcerns", () => {
  it("reports a possibly-forbidden ingredient as doubtful", () => {
    expect(findConcerns(["pepperoni"], "halal", kb.religiousRules)).toEqual([
      { ingredient: "pepperoni", severity: "doubtful" },
    ]);
  });
  it("applies only rules of the chosen scheme", () => {
    expect(findConcerns(["carmine"], "halal", kb.religiousRules)).toEqual([]);
    expect(findConcerns(["carmine"], "kosher", kb.religiousRules)).toHaveLength(1);
  });
});

describe("meatDairyConcern", () => {
  it("breaks kosher law for meat with dairy", () => {
    const f = buildProductFacts("beef, cheese");
    expect(meatDairyConcern(f.categoryHits)).toEqual({ ingredient: "meat with dairy", severity: "forbidden" });
  });
  it("allows dairy without meat", () => {
    expect(meatDairyConcern(buildProductFacts("tuna, cheese").categoryHits)).toBeNull();
  });
});

describe("parseKosherMark", () => {
  it("maps P to passover, not pareve", () => {
    expect(parseKosherMark("OU-P")).toEqual({ agency: "OU", designation: "passover" });
  });
  it("reads dairy and meat designations", () => {
    expect(parseKosherMark("OU-D")?.designation).toBe("dairy");
    expect(parseKosherMark("Star-K M")?.designation).toBe("meat");
  });
  it("ignores the word ok in ordinary text", () => {
    expect(parseKosherMark("this is ok")).toBeNull();
  });
});
