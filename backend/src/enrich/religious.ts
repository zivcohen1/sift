import { cachedTermRegex, normalizeText } from "../refdata";
import type { CategoryHit, ReligiousRule, Scheme } from "../types";

export type ReligiousStatus =
  | "certified"
  | "forbidden_ingredient"
  | "conflicting_data"
  | "doubtful_ingredient"
  | "not_certified"
  | "no_listed_conflicts"
  | "insufficient_data";

export interface Certification {
  agencyId: string | null;   // null for a generic claim such as the word "kosher"
  agencyName: string;
  confidence: "low" | "medium" | "high";
}

export interface Concern {
  ingredient: string;
  severity: "forbidden" | "doubtful";
}

export interface ReligiousAssessment {
  scheme: Scheme;
  status: ReligiousStatus;
  certifications: Certification[];
  concerns: Concern[];
  summary: string;
}

/** Check ingredients against the religious rules. A merely "possible" forbidden rule is doubtful. */
export function findConcerns(ingredients: string[], scheme: Scheme, rules: ReligiousRule[]): Concern[] {
  const concerns: Concern[] = [];
  for (const rule of rules) {
    if (!rule.schemes.includes(scheme)) continue;
    const re = cachedTermRegex(rule.ingredient);
    for (const ing of ingredients) {
      if (!re.test(normalizeText(ing))) continue;
      const severity = rule.severity === "forbidden" && rule.certainty === "possible" ? "doubtful" : rule.severity;
      concerns.push({ ingredient: rule.ingredient, severity });
    }
  }
  return concerns;
}

/** Meat together with dairy breaks kosher law. Fish with dairy does not (fish is not in the meat category). */
export function meatDairyConcern(hits: CategoryHit[]): Concern | null {
  const definite = (id: string) => hits.some((h) => h.categoryId === id && h.certainty === "definite");
  return definite("meat") && definite("dairy") ? { ingredient: "meat with dairy", severity: "forbidden" } : null;
}

const KOSHER_MARK = /\b(OU|OK|Star-K|Kof-K|cRc)(?:[-\s]?(DE|D|M|P|Pareve))?\b/;
const DESIGNATIONS: Record<string, string> = {
  D: "dairy", DE: "dairy_equipment", M: "meat", P: "passover", Pareve: "pareve",
};

/** Read a kosher mark such as "OU-D". Case-sensitive on purpose: "ok" in a sentence is not an agency. */
export function parseKosherMark(text: string): { agency: string; designation: string | null } | null {
  const m = KOSHER_MARK.exec(text);
  if (!m || !m[1]) return null;
  return { agency: m[1], designation: m[2] ? (DESIGNATIONS[m[2]] ?? null) : null };   // OU-P is Passover, not pareve
}

/**
 * Decide the product-level status. The order matters: a forbidden ingredient next to a
 * certification is a conflict to flag, and kosher without supervision is never assumed.
 */
export function assessReligious(input: {
  scheme: Scheme;
  concerns: Concern[];
  certifications: Certification[];
  hasIngredients: boolean;
}): ReligiousAssessment {
  const { scheme, concerns, certifications, hasIngredients } = input;
  const forbidden = concerns.filter((c) => c.severity === "forbidden");
  const doubtful = concerns.filter((c) => c.severity === "doubtful");
  const trusted = certifications.filter((c) => c.agencyId !== null && c.confidence !== "low");
  const names = (xs: Concern[]) => xs.map((x) => x.ingredient).join(", ");

  let status: ReligiousStatus;
  let summary: string;

  if (forbidden.length && certifications.length) {
    status = "conflicting_data";
    summary = `Shows a ${scheme} certification but lists ${forbidden[0]?.ingredient}. The data may be wrong - check the package.`;
  } else if (forbidden.length) {
    status = "forbidden_ingredient";
    summary = `Contains ${names(forbidden)}.`;
  } else if (trusted.length) {
    status = "certified";
    summary = `Certification found: ${trusted.map((c) => c.agencyName).join(", ")}.`;
  } else if (!hasIngredients) {
    status = "insufficient_data";
    summary = "No ingredient list available.";
  } else if (scheme === "halal" && doubtful.length) {
    status = "doubtful_ingredient";
    summary = `No halal certification found, and the source of ${names(doubtful)} is unclear.`;
  } else if (scheme === "kosher") {
    status = "not_certified";
    summary = certifications.length
      ? "Only a generic 'kosher' claim was found, with no recognised agency."
      : "No kosher certification found.";
  } else {
    status = "no_listed_conflicts";
    summary = "No halal certification found; no listed ingredients conflict with halal rules.";
  }
  return { scheme, status, certifications, concerns, summary };
}
