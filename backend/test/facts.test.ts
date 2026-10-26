import { describe, expect, it } from "vitest";
import { buildProductFacts } from "../src/enrich";

describe("buildProductFacts", () => {
  it("handles the chocolate-bar example from the design document", () => {
    const f = buildProductFacts("cocoa butter, sugar, whey, natural flavors");
    const dairy = f.categoryHits.filter((h) => h.categoryId === "dairy");
    expect(dairy).toHaveLength(1);
    expect(dairy[0]).toMatchObject({ ingredient: "whey", certainty: "definite" });
    expect(f.ambiguous.map((a) => a.name)).toEqual(["natural flavor"]);
  });

  it("caps hits from a May contain statement at possible", () => {
    const f = buildProductFacts("sugar. May contain: almonds.");
    expect(f.categoryHits).toEqual([
      expect.objectContaining({ categoryId: "tree_nut", certainty: "possible", fromMayContain: true }),
    ]);
    expect(f.hasIngredients).toBe(true);
    expect(f.mayContain).toEqual(["almonds"]);
  });

  it("makes every wheat hit a gluten hit", () => {
    const f = buildProductFacts("wheat flour");
    expect(f.categoryHits.map((h) => h.categoryId).sort()).toEqual(["gluten", "wheat"]);
    expect(f.categoryHits.find((h) => h.categoryId === "gluten")?.impliedBy).toBe("wheat");
  });

  it("prefers a definite hit over a possible one for the same ingredient", () => {
    const f = buildProductFacts("milk. May contain: milk.");
    const milk = f.categoryHits.filter((h) => h.categoryId === "dairy");
    expect(milk.every((h) => h.certainty === "definite" || h.fromMayContain)).toBe(true);
    expect(milk.some((h) => h.certainty === "definite")).toBe(true);
  });

  it("does not report gelatin as ambiguous when a qualifier settles it", () => {
    expect(buildProductFacts("fish gelatin, sugar").ambiguous).toEqual([]);
    expect(buildProductFacts("gelatin, sugar").ambiguous.map((a) => a.name)).toEqual(["gelatin"]);
  });

  it("reports no ingredients for empty or may-contain-only input", () => {
    expect(buildProductFacts("").hasIngredients).toBe(false);
    expect(buildProductFacts("May contain: milk").hasIngredients).toBe(false);
  });

  it("is deterministic and records the knowledge-base version", () => {
    const text = "enriched flour (wheat flour, niacin), milk";
    expect(buildProductFacts(text)).toEqual(buildProductFacts(text));
    expect(buildProductFacts(text).kbVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("does not mistake graham for ham, or malted for malt", () => {
    const f = buildProductFacts("graham flour, sugar");
    expect(f.categoryHits.some((h) => h.categoryId === "meat")).toBe(false);
    expect(f.categoryHits.some((h) => h.categoryId === "wheat")).toBe(true);
  });
});
