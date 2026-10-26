import { describe, expect, it } from "vitest";
import { termRegex } from "../src/refdata";
import { matchCategory } from "../src/enrich";
import { loadKnowledgeBase } from "../src/refdata";

const kb = loadKnowledgeBase();
const cat = (id: string) => kb.categories.find((c) => c.id === id)!;

describe("termRegex", () => {
  it("matches whole words only", () => {
    expect(termRegex("ham").test("graham cracker")).toBe(false);
    expect(termRegex("ham").test("smoked ham")).toBe(true);
  });
  it("accepts plurals and varied separators", () => {
    expect(termRegex("tree nut").test("tree-nuts")).toBe(true);
    expect(termRegex("almond").test("almonds")).toBe(true);
  });
  it("escapes regex characters in terms", () => {
    expect(() => termRegex("a+b(c")).not.toThrow();
  });
});

describe("matchCategory", () => {
  it("finds a definite term", () => {
    expect(matchCategory("whey powder", cat("dairy"))).toEqual({ term: "whey", certainty: "definite" });
  });
  it("respects exclusion phrases", () => {
    expect(matchCategory("cocoa butter", cat("dairy"))).toBeNull();
    expect(matchCategory("buckwheat flour", cat("wheat"))).toBeNull();
    expect(matchCategory("water chestnut", cat("tree_nut"))).toBeNull();
  });
  it("does not treat gluten-free as gluten", () => {
    expect(matchCategory("gluten-free oats", cat("gluten"))).toBeNull();
  });
  it("matches E-numbers as definite", () => {
    expect(matchCategory("acidity regulator (E338)", cat("phosphate_additives"))).toEqual({
      term: "E338",
      certainty: "definite",
    });
  });
  it("returns possible for possible terms", () => {
    expect(matchCategory("modified food starch", cat("gluten"))).toEqual({
      term: "modified food starch",
      certainty: "possible",
    });
  });
});
