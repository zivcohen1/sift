import { describe, expect, it } from "vitest";
import { flattenNodes, parseIngredientStatement, splitTopLevel } from "../src/enrich";

describe("splitTopLevel", () => {
  it("ignores commas inside brackets", () => {
    expect(splitTopLevel("flour (wheat, niacin), sugar")).toEqual(["flour (wheat, niacin)", "sugar"]);
  });
});

describe("parseIngredientStatement", () => {
  it("nests sub-ingredients under their parent", () => {
    const [node] = parseIngredientStatement("Ingredients: enriched flour (wheat flour, niacin), sugar");
    expect(node?.text).toBe("enriched flour");
    expect(node?.children.map((c) => c.text)).toEqual(["wheat flour", "niacin"]);
  });

  it("keeps percentages", () => {
    const nodes = parseIngredientStatement("sugar (45%), cocoa 20%");
    expect(nodes.map((n) => [n.text, n.percent])).toEqual([["sugar", 45], ["cocoa", 20]]);
  });

  it("separates Contains and May contain statements", () => {
    const nodes = parseIngredientStatement("sugar, cocoa. Contains: milk. May contain: peanuts, almonds.");
    expect(nodes.filter((n) => n.statement === "contains").map((n) => n.text)).toEqual(["milk"]);
    expect(nodes.filter((n) => n.statement === "may_contain").map((n) => n.text)).toEqual(["peanuts", "almonds"]);
  });

  it("does not treat 'contains 2% or less of' as an allergen statement", () => {
    const nodes = parseIngredientStatement("flour, contains 2% or less of: salt, yeast");
    expect(nodes.map((n) => [n.text, n.statement])).toEqual([
      ["flour", "ingredients"], ["salt", "ingredients"], ["yeast", "ingredients"],
    ]);
  });

  it("handles 'contains less than 2% of' in upper case", () => {
    const nodes = parseIngredientStatement("SUGAR, CONTAINS LESS THAN 2% OF: SALT");
    expect(nodes.map((n) => n.text)).toEqual(["SUGAR", "SALT"]);
  });

  it("recognises facility statements as may-contain", () => {
    const nodes = parseIngredientStatement("sugar. Made in a facility that also processes tree nuts.");
    expect(nodes.at(-1)?.statement).toBe("may_contain");
  });

  it("returns an empty list for empty input", () => {
    expect(parseIngredientStatement("   ")).toEqual([]);
  });

  it("flattens parents before children", () => {
    const flat = flattenNodes(parseIngredientStatement("lecithin (soy), salt"));
    expect(flat.map((n) => n.text)).toEqual(["lecithin", "soy", "salt"]);
  });
});
