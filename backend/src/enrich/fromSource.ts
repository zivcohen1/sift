import { loadKnowledgeBase } from "../refdata";
import type { KnowledgeBase, ProductFacts, Scheme } from "../types";
import { buildProductFacts } from "./index";
import {
  assessReligious, findConcerns, meatDairyConcern, parseKosherMark,
  type Certification, type ReligiousAssessment,
} from "./religious";

/**
 * The fields of a source product that enrichment reads. Both the Open Food Facts
 * `FoodProduct` and the USDA `UsdaProduct` are assignable to this, so this file
 * does not import either reader and cannot break when they change.
 */
export interface SourceProductLike {
  ingredientsText?: string;
  labelsText?: string;          // Open Food Facts only, e.g. "Kosher, OU-D"
  labelTags?: string[];         // Open Food Facts only, e.g. ["en:ou-kosher"]
  traceTags?: string[];         // "may contain"
  allergenTags?: string[];      // declared allergens
  nutrition: { basis: "per_100g"; values: Record<string, number> } | null;
}

export type SourceName = "open_food_facts" | "usda" | "label_photo";

export interface EnrichedProduct {
  facts: ProductFacts;
  nutrientsPer100g: Record<string, number>;
  religious: Record<Scheme, ReligiousAssessment>;
  warnings: string[];
}

/** "en:tree-nuts" -> "tree nuts" */
const tagToPhrase = (tag: string) => tag.replace(/^[a-z]{2}:/, "").replace(/-/g, " ");

/** Agencies recognised in Open Food Facts label tags. Extend as the knowledge base grows. */
const TAG_AGENCIES: Array<{ pattern: RegExp; scheme: Scheme; id: string; name: string }> = [
  { pattern: /(^|:)ou-kosher|orthodox-union/, scheme: "kosher", id: "ou", name: "OU" },
  { pattern: /star-k/, scheme: "kosher", id: "star-k", name: "Star-K" },
  { pattern: /kof-k/, scheme: "kosher", id: "kof-k", name: "Kof-K" },
  { pattern: /islamic-food-and-nutrition-council|ifanca/, scheme: "halal", id: "ifanca", name: "IFANCA" },
];
const GENERIC_TAG: Record<Scheme, RegExp> = {
  kosher: /kosher|casher|koscher/,
  halal: /halal/,
};
const MARK_AGENCIES: Record<string, { id: string; name: string }> = {
  OU: { id: "ou", name: "OU" }, OK: { id: "ok", name: "OK" },
  "Star-K": { id: "star-k", name: "Star-K" }, "Kof-K": { id: "kof-k", name: "Kof-K" },
  cRc: { id: "crc", name: "cRc" },
};

export interface KnownAgency {
  id: string;
  name: string;
  scheme: Scheme;
}

/**
 * Every agency the evidence readers can recognise, for GET /v1/reference. Built from the
 * same tables collectCertifications uses, so the app's certifier picker can never offer an
 * agency the backend would not detect.
 */
export function listKnownAgencies(): KnownAgency[] {
  const byKey = new Map<string, KnownAgency>();
  for (const a of TAG_AGENCIES) byKey.set(`${a.scheme}:${a.id}`, { id: a.id, name: a.name, scheme: a.scheme });
  for (const a of Object.values(MARK_AGENCIES)) byKey.set(`kosher:${a.id}`, { ...a, scheme: "kosher" });
  return [...byKey.values()].sort((x, y) => x.scheme.localeCompare(y.scheme) || x.name.localeCompare(y.name));
}

/**
 * Collect certification evidence for one scheme (Table 7 of the design document).
 * Label tags and free text are crowd-sourced, so a named agency is medium confidence;
 * a bare "kosher" or "halal" claim is low and never counts as certified.
 */
export function collectCertifications(src: SourceProductLike, scheme: Scheme): Certification[] {
  const found = new Map<string, Certification>();
  const tags = (src.labelTags ?? []).map((t) => t.toLowerCase());

  for (const tag of tags) {
    const agency = TAG_AGENCIES.find((a) => a.scheme === scheme && a.pattern.test(tag));
    if (agency) found.set(agency.id, { agencyId: agency.id, agencyName: agency.name, confidence: "medium" });
    else if (GENERIC_TAG[scheme].test(tag)) {
      found.set("generic", { agencyId: null, agencyName: `${scheme} claim`, confidence: "low" });
    }
  }
  if (scheme === "kosher" && src.labelsText) {
    const mark = parseKosherMark(src.labelsText);
    const agency = mark ? MARK_AGENCIES[mark.agency] : undefined;
    if (agency) found.set(agency.id, { agencyId: agency.id, agencyName: agency.name, confidence: "medium" });
  }
  return [...found.values()];
}

/**
 * Everything the phone's RuleEngine needs from one source product:
 * ProductFacts, nutrients per 100 g, and the kosher and halal assessments.
 * Open Food Facts trace and allergen tags are folded into the ingredient
 * statement as "May contain" and "Contains" clauses, so one parser handles all sources.
 */
export function enrichProduct(
  src: SourceProductLike,
  origin: SourceName,
  kb: KnowledgeBase = loadKnowledgeBase(),
): EnrichedProduct {
  const clauses = [src.ingredientsText?.trim() ?? ""];
  if (src.allergenTags?.length) clauses.push(`Contains: ${src.allergenTags.map(tagToPhrase).join(", ")}.`);
  if (src.traceTags?.length) clauses.push(`May contain: ${src.traceTags.map(tagToPhrase).join(", ")}.`);

  const facts = buildProductFacts(clauses.filter(Boolean).join(" "), kb);

  const religious = {} as Record<Scheme, ReligiousAssessment>;
  for (const scheme of ["kosher", "halal"] as const) {
    const concerns = findConcerns(facts.ingredients, scheme, kb.religiousRules);
    const combo = scheme === "kosher" ? meatDairyConcern(facts.categoryHits) : null;
    religious[scheme] = assessReligious({
      scheme,
      concerns: combo ? [...concerns, combo] : concerns,
      certifications: collectCertifications(src, scheme),
      hasIngredients: facts.hasIngredients,
    });
  }

  const warnings: string[] = [];
  if (!facts.hasIngredients) warnings.push("no_ingredient_list");
  if (!src.nutrition) warnings.push("no_nutrition_data");
  if (origin === "open_food_facts") warnings.push("crowd_sourced_check_the_package");

  return { facts, nutrientsPer100g: src.nutrition?.values ?? {}, religious, warnings };
}
