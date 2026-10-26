/** Shared types for the ingredient-enrichment core. */

export type Certainty = "definite" | "possible";
export type Scheme = "kosher" | "halal";

/** One entry of the reference knowledge base (data/categories.json). */
export interface CategoryDef {
  id: string;
  label: string;
  terms: string[];
  possibleTerms: string[];
  eNumbers: string[];
  excludePhrases: string[];
  /** A hit in any of these categories is also a hit here (e.g. wheat implies gluten). */
  impliedBy: string[];
}

/** Terms that might belong to a category but cannot be settled from the label alone. */
export interface AmbiguousDef {
  term: string;
  mightBelongTo: string[];
  /** Phrases that settle the question (e.g. "fish gelatin"). */
  qualifiers: string[];
}

export interface ReligiousRule {
  ingredient: string;
  schemes: Scheme[];
  severity: "forbidden" | "doubtful";
  /** A forbidden rule that only possibly applies is reported as doubtful. */
  certainty: Certainty;
}

export interface KnowledgeBase {
  version: string;
  categories: CategoryDef[];
  ambiguous: AmbiguousDef[];
  religiousRules: ReligiousRule[];
}

export type Statement = "ingredients" | "contains" | "may_contain";

/** A node of the parsed ingredient statement. */
export interface IngredientNode {
  text: string;
  percent: number | null;
  children: IngredientNode[];
  statement: Statement;
}

export interface CategoryHit {
  categoryId: string;
  term: string;
  certainty: Certainty;
  ingredient: string;
  fromMayContain: boolean;
  /** Set when the hit comes from another category (e.g. "wheat"). */
  impliedBy?: string;
}

export interface AmbiguousItem {
  name: string;
  ingredient: string;
  mightBelongTo: string[];
}

/** User-independent description of a product (the Worker's output). */
export interface ProductFacts {
  ingredients: string[];
  mayContain: string[];
  hasIngredients: boolean;
  categoryHits: CategoryHit[];
  ambiguous: AmbiguousItem[];
  kbVersion: string;
}
