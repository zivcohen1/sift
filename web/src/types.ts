/**
 * Shapes of the Sift API response (GET /v1/product/{barcode}).
 * Mirrors backend/src/worker.ts (toResponse) and backend/src/enrich/fromSource.ts (EnrichedProduct).
 * contracts/enriched_sample.json is a real example of `enriched`.
 */

export type Certainty = "definite" | "possible";
export type Scheme = "kosher" | "halal";

export interface CategoryHit {
  categoryId: string;
  term: string;
  certainty: Certainty;
  ingredient: string;
  fromMayContain: boolean;
  impliedBy?: string;
}

export interface AmbiguousItem {
  name: string;
  ingredient: string;
  mightBelongTo: string[];
}

export interface ProductFacts {
  ingredients: string[];
  mayContain: string[];
  hasIngredients: boolean;
  categoryHits: CategoryHit[];
  ambiguous: AmbiguousItem[];
  kbVersion: string;
}

export type ReligiousStatus =
  | "certified"
  | "forbidden_ingredient"
  | "conflicting_data"
  | "doubtful_ingredient"
  | "not_certified"
  | "no_listed_conflicts"
  | "insufficient_data";

export interface Certification {
  agencyId: string | null;
  agencyName: string;
  confidence: "low" | "medium" | "high";
}

export interface ReligiousAssessment {
  scheme: Scheme;
  status: ReligiousStatus;
  certifications: Certification[];
  concerns: Array<{ ingredient: string; severity: "forbidden" | "doubtful" }>;
  summary: string;
}

export interface EnrichedProduct {
  facts: ProductFacts;
  nutrientsPer100g: Record<string, number>;
  religious: Record<Scheme, ReligiousAssessment>;
  warnings: string[];
}

/** The raw product from Open Food Facts or USDA. Only the fields the website shows. */
export interface ProductInfo {
  barcode?: string;
  name?: string;
  brand?: string;
  imageUrl?: string;
  ingredientsText?: string;
  sourceUrl?: string;
}

export interface ProductResponse {
  barcode: string;
  sources: string[];
  fromCache: boolean;
  product: ProductInfo;
  enriched: EnrichedProduct;
}
