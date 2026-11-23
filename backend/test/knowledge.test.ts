import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../src/refdata";
import { buildProductFacts } from "../src/enrich";

const kb = loadKnowledgeBase();
const ids = new Set(kb.categories.map((c) => c.id));
const hits = (text: string) => buildProductFacts(text).categoryHits.map((h) => h.categoryId);

describe("knowledge base integrity", () => {
  it("has the 26 categories from the design document (12 allergen, 4 medical, 6 diet, 4 religious)", () => {
    expect(kb.categories).toHaveLength(26);
    const count = (g: string) => kb.categories.filter((c) => c.group === g).length;
    expect([count("allergen"), count("medical"), count("diet"), count("religious")]).toEqual([12, 4, 6, 4]);
  });

  it("has unique ids and every category has a label, a group and at least one way to match", () => {
    expect(ids.size).toBe(kb.categories.length);
    for (const c of kb.categories) {
      expect(c.label.length, c.id).toBeGreaterThan(0);
      expect(c.group, c.id).toBeDefined();
      expect(c.terms.length + c.eNumbers.length, c.id).toBeGreaterThan(0);
    }
  });

  it("only refers to categories that exist (impliedBy, ambiguous terms)", () => {
    for (const c of kb.categories) for (const id of c.impliedBy) expect(ids.has(id), `${c.id} impliedBy ${id}`).toBe(true);
    for (const a of kb.ambiguous) for (const id of a.mightBelongTo) expect(ids.has(id), `${a.term} -> ${id}`).toBe(true);
  });

  it("keeps E-numbers in the E### format the matcher reads", () => {
    for (const c of kb.categories) for (const e of c.eNumbers) expect(e, c.id).toMatch(/^E\d{3,4}[A-Z]?$/);
  });

  it("never lists a term inside its own category's exclusion phrases", () => {
    for (const c of kb.categories) {
      for (const t of [...c.terms, ...c.possibleTerms]) expect(c.excludePhrases, `${c.id}: ${t}`).not.toContain(t);
    }
  });
});

describe("knowledge base matching", () => {
  it.each([
    ["scrambled eggs", "egg"],
    ["peanut oil", "peanut"],
    ["soy lecithin", "soy"],
    ["anchovies", "fish"],
    ["shrimp", "shellfish"],
    ["tahini", "sesame"],
    ["dijon mustard", "mustard"],
    ["sodium metabisulfite", "sulfites"],
    ["preservative (E220)", "sulfites"],
    ["aspartame", "phenylalanine_source"],
    ["potassium chloride", "potassium_additives"],
    ["monosodium glutamate", "sodium_additives"],
    ["honey", "honey"],
    ["sucralose", "artificial_sweeteners"],
    ["high fructose corn syrup", "added_sugars"],
    ["guarana extract", "caffeine"],
    ["bacon", "pork"],
    ["red wine", "alcohol"],
    ["blood plasma", "blood"],
    ["carmine", "insect_derived"],
    ["colour (E120)", "insect_derived"],
  ])("flags %s as %s", (text, category) => {
    expect(hits(text)).toContain(category);
  });

  it.each([
    ["cream of tartar", "dairy"],
    ["almond milk", "dairy"],
    ["butter beans", "dairy"],
    ["eggplant", "egg"],
    ["nutmeg", "tree_nut"],
    ["oyster mushrooms", "shellfish"],
    ["swedish fish", "fish"],
    ["rice flour", "wheat"],
    ["buckwheat flour", "wheat"],
    ["white wine vinegar", "alcohol"],
    ["sugar alcohol", "alcohol"],
    ["sugar-free", "added_sugars"],
    ["decaffeinated coffee", "caffeine"],
    ["turkey bacon", "pork"],
    ["blood orange", "blood"],
    ["coconut meat", "meat"],
  ])("does not flag %s as %s", (text, category) => {
    expect(hits(text)).not.toContain(category);
  });

  it("treats flour as a possible, not definite, wheat source", () => {
    const hit = buildProductFacts("flour").categoryHits.find((h) => h.categoryId === "wheat");
    expect(hit?.certainty).toBe("possible");
  });

  it("settles 'sunflower lecithin' but not plain 'lecithin'", () => {
    expect(buildProductFacts("sunflower lecithin").ambiguous).toEqual([]);
    expect(buildProductFacts("lecithin").ambiguous.map((a) => a.name)).toEqual(["lecithin"]);
  });
});
