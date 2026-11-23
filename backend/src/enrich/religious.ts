import { cachedTermRegex, normalizeText } from "../refdata";
import type { CategoryHit, ReligiousRule, Scheme } from "../types";
import { stripPhrases } from "./categories";

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
  /** Label words to mark in the ingredient list when they differ from `ingredient`
   *  (for "meat with dairy": the meat and the dairy ingredients). */
  terms?: string[];
  /** Only counts when no recognised certification is found (e.g. wine for kosher). */
  unlessCertified?: boolean;
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
      if (!re.test(stripPhrases(normalizeText(ing), rule.excludePhrases))) continue;
      const severity = rule.severity === "forbidden" && rule.certainty === "possible" ? "doubtful" : rule.severity;
      concerns.push({ ingredient: rule.ingredient, severity, ...(rule.unlessCertified ? { unlessCertified: true } : {}) });
    }
  }
  return concerns;
}

/**
 * Categories whose words break each scheme. Using the category lists means kosher and halal get
 * every term ("ham", "shrimp", "E120"), the same exclusions ("turkey bacon", "blood orange") and
 * the "Contains:" statements that the allergy check already handles.
 */
const SCHEME_CATEGORIES: Record<Scheme, string[]> = {
  kosher: ["pork", "shellfish", "blood", "insect_derived"],
  halal: ["pork", "blood", "alcohol"],
};
/** Insect-derived glazes that most kosher agencies accept: flagged as doubtful, not forbidden. */
const DOUBTFUL_TERMS = new Set(["shellac", "confectioner's glaze", "confectioners glaze", "resinous glaze", "E904"]);

export function categoryConcerns(hits: CategoryHit[], scheme: Scheme): Concern[] {
  return hits
    .filter((h) => SCHEME_CATEGORIES[scheme].includes(h.categoryId) && !h.impliedBy)
    .map((h) => ({
      ingredient: h.term,
      severity:
        h.certainty === "definite" && !h.fromMayContain && !DOUBTFUL_TERMS.has(h.term) ? "forbidden" : "doubtful",
    }));
}

/** One concern per ingredient, keeping the more serious severity. */
export function mergeConcerns(...lists: Concern[][]): Concern[] {
  const byName = new Map<string, Concern>();
  for (const c of lists.flat()) {
    const key = c.ingredient.toLowerCase();
    const current = byName.get(key);
    if (!current || (current.severity === "doubtful" && c.severity === "forbidden")) byName.set(key, c);
  }
  return [...byName.values()];
}

/** Meat together with dairy breaks kosher law. Fish with dairy does not (fish is not in the meat category). */
export function meatDairyConcern(hits: CategoryHit[]): Concern | null {
  const definite = (id: string) =>
    hits.filter((h) => h.categoryId === id && h.certainty === "definite" && !h.fromMayContain).map((h) => h.term);
  const meat = definite("meat");
  const dairy = definite("dairy");
  if (!meat.length || !dairy.length) return null;
  return { ingredient: "meat with dairy", severity: "forbidden", terms: [...new Set([...meat, ...dairy])] };
}

/**
 * Kosher marks in free label text. OU and OK stay upper-case on purpose: "ok" in a sentence,
 * or the French word "ou", is not an agency. Star-K, Kof-K and cRc are read in any case,
 * with a hyphen or a space ("STAR-K", "Star K", "CRC").
 */
const DESIGNATION = String.raw`(?:[-\s]?(DE|D|M|P|F|Pareve)\b)?`;
const KOSHER_MARKS: Array<{ agency: string; re: RegExp }> = [
  { agency: "OU", re: new RegExp(String.raw`\bOU\b${DESIGNATION}`, "g") },
  { agency: "OK", re: new RegExp(String.raw`\bOK\b${DESIGNATION}|\bOk[-\s]Kosher\b`, "g") },
  { agency: "Star-K", re: new RegExp(String.raw`\bstar[-\s]k\b${DESIGNATION}`, "gi") },   // not the word "Stark"
  { agency: "Kof-K", re: new RegExp(String.raw`\bkof[-\s]?k\b${DESIGNATION}`, "gi") },
  { agency: "cRc", re: /\bcrc\b/gi },
];
const DESIGNATIONS: Record<string, string> = {
  d: "dairy", de: "dairy_equipment", m: "meat", p: "passover", f: "fish", pareve: "pareve",
};

export interface KosherMark {
  agency: string;
  designation: string | null;
}

/** Every kosher mark in the text, in the order they appear ("OK, Star-K" gives both). */
export function parseKosherMarks(text: string): KosherMark[] {
  const found: Array<KosherMark & { at: number }> = [];
  for (const { agency, re } of KOSHER_MARKS) {
    for (const m of text.matchAll(re)) {
      const d = m[1]?.toLowerCase();
      found.push({ agency, designation: d ? (DESIGNATIONS[d] ?? null) : null, at: m.index ?? 0 });   // OU-P is Passover, not pareve
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ agency, designation }) => ({ agency, designation }));
}

/** The first kosher mark, such as "OU-D", or null. */
export function parseKosherMark(text: string): KosherMark | null {
  return parseKosherMarks(text)[0] ?? null;
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
  const { scheme, certifications, hasIngredients } = input;
  const trusted = certifications.filter((c) => c.agencyId !== null && c.confidence !== "low");
  // Wine and the like only count when no recognised agency certifies the product.
  const active = trusted.length ? input.concerns.filter((c) => !c.unlessCertified) : input.concerns;
  const needsCertification = active.some((c) => c.unlessCertified && c.severity === "forbidden");
  const concerns: Concern[] = active.map(({ unlessCertified: _drop, ...c }) => c);
  const forbidden = concerns.filter((c) => c.severity === "forbidden");
  const doubtful = concerns.filter((c) => c.severity === "doubtful");
  const names = (xs: Concern[]) => xs.map((x) => x.ingredient).join(", ");

  let status: ReligiousStatus;
  let summary: string;

  // Only a recognised agency makes a conflict: a bare "kosher" tag next to pork is still pork.
  if (forbidden.length && trusted.length) {
    status = "conflicting_data";
    summary = `Shows a ${scheme} certification but lists ${forbidden[0]?.ingredient}. The data may be wrong - check the package.`;
  } else if (forbidden.length) {
    status = "forbidden_ingredient";
    summary = `Contains ${names(forbidden)}.` +
      (needsCertification ? ` Wine and grape juice are ${scheme} only with a certification, and none was found.` : "");
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
