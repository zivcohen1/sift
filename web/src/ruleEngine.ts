/**
 * RuleEngine: ProductFacts + the user's restrictions -> one verdict with its reasons.
 *
 * TypeScript version of the algorithm in the design document (§4.2), so it can run in the
 * browser. It runs on the user's device; the profile is never sent anywhere.
 *
 *   - The most severe finding wins: avoid > caution > not sure > good.
 *   - Missing or unclear data gives Not Sure, never a silent Good.
 *   - "Good" is always shown as "no listed conflicts", never "safe".
 */
import type { Profile } from "./profile";
import { categoryLabel, HALAL_AGENCIES, KOSHER_AGENCIES } from "./reference";
import type { EnrichedProduct, ReligiousAssessment, Scheme } from "./types";

export type Level = "good" | "not_sure" | "caution" | "avoid";

export const LEVEL_RANK: Record<Level, number> = { good: 0, not_sure: 1, caution: 2, avoid: 3 };

/** How one ingredient row is marked in "Ingredients checked". */
export interface IngredientMark {
  /** Text to find in an ingredient row, e.g. "bacon" matches "bacon bits". */
  match: string;
  level: Level;
  text: string;
}

export interface Finding {
  level: Level;
  title: string;
  detail: string;
  source: "ingredients" | "may_contain" | "ambiguous" | Scheme | "data";
  marks: IngredientMark[];
}

export interface Verdict {
  level: Level;
  /** Most severe first. */
  findings: Finding[];
}

const lower = (s: string) => s.toLowerCase();
const quoteList = (items: string[]) => items.map((i) => `"${i}"`).join(" and ");
const unique = <T>(items: T[]) => [...new Set(items)];

export function decideVerdict(enriched: EnrichedProduct, profile: Profile): Verdict {
  const { facts } = enriched;
  const doubtful: Level = profile.doubtfulPolicy;
  const avoided = new Set(profile.avoid);
  const findings: Finding[] = [];

  if (!facts.hasIngredients) {
    findings.push({
      level: "not_sure",
      title: "No ingredient list",
      detail: "Sift could not find this product's ingredients, so it cannot check them. Read the package.",
      source: "data",
      marks: [],
    });
  }

  // 1. Categories the user avoids. Definite hits are grouped per category ("Contains dairy").
  const definiteByCategory = new Map<string, string[]>();
  const possibleByCategory = new Map<string, { ingredients: string[]; mayContain: boolean }>();
  for (const hit of facts.categoryHits) {
    if (!avoided.has(hit.categoryId)) continue;
    if (hit.certainty === "definite" && !hit.fromMayContain) {
      definiteByCategory.set(hit.categoryId, [...(definiteByCategory.get(hit.categoryId) ?? []), hit.ingredient]);
    } else {
      const entry = possibleByCategory.get(hit.categoryId) ?? { ingredients: [], mayContain: false };
      entry.ingredients.push(hit.ingredient);
      entry.mayContain ||= hit.fromMayContain;
      possibleByCategory.set(hit.categoryId, entry);
    }
  }
  for (const [categoryId, ingredients] of definiteByCategory) {
    const label = categoryLabel(categoryId);
    const names = unique(ingredients);
    findings.push({
      level: "avoid",
      title: `Contains ${lower(label)}`,
      detail: `Listed as ${quoteList(names)} on this label.`,
      source: "ingredients",
      marks: names.map((match) => ({ match, level: "avoid", text: label })),
    });
  }
  for (const [categoryId, { ingredients, mayContain }] of possibleByCategory) {
    if (definiteByCategory.has(categoryId)) continue; // already Avoid for this category
    const label = categoryLabel(categoryId);
    const names = unique(ingredients);
    findings.push({
      level: doubtful,
      title: mayContain ? `May contain ${lower(label)}` : `Possibly ${lower(label)}`,
      detail: mayContain
        ? `The label warns it may contain ${quoteList(names)}.`
        : `${quoteList(names)} may be ${lower(label)}.`,
      source: mayContain ? "may_contain" : "ingredients",
      marks: names.map((match) => ({ match, level: doubtful, text: "Check" })),
    });
  }

  // 2. Ingredients whose source the label does not say ("natural flavor").
  //    Until the AI check is connected, an unresolved one that touches this user's rules is Not Sure.
  for (const item of facts.ambiguous) {
    const touched = item.mightBelongTo.filter((c) => avoided.has(c));
    if (!touched.length) continue;
    findings.push({
      level: "not_sure",
      title: `Can't tell about ${item.name}`,
      detail: `"${item.ingredient}" could contain ${touched.map((c) => lower(categoryLabel(c))).join(" or ")}. The label doesn't say.`,
      source: "ambiguous",
      marks: [{ match: item.ingredient, level: "not_sure", text: "Check" }],
    });
  }

  // 3. Kosher / halal, using the status the API already decided (design document, Table 12).
  for (const scheme of ["kosher", "halal"] as const) {
    if (!profile[scheme].on) continue;
    findings.push(religiousFinding(scheme, enriched.religious?.[scheme], profile[scheme].accepted, doubtful));
  }

  findings.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  const level = findings.reduce<Level>(
    (worst, f) => (LEVEL_RANK[f.level] > LEVEL_RANK[worst] ? f.level : worst),
    "good",
  );
  return { level, findings };
}

function religiousFinding(
  scheme: Scheme,
  a: ReligiousAssessment | undefined,
  accepted: string[],
  doubtful: Level,
): Finding {
  const name = scheme === "kosher" ? "Kosher" : "Halal";
  if (!a) {
    return {
      level: "not_sure",
      title: `${name}: no information`,
      detail: `Sift could not check ${scheme} status for this product.`,
      source: scheme,
      marks: [],
    };
  }
  // Each concern marks its own ingredient: forbidden ones as "Not kosher", doubtful ones as "Check".
  const marks: IngredientMark[] = a.concerns.map((c) =>
    c.severity === "forbidden"
      ? { match: c.ingredient, level: "avoid", text: `Not ${scheme}` }
      : { match: c.ingredient, level: doubtful, text: "Check" },
  );
  const finding = (level: Level, title: string, detail: string): Finding => ({
    level,
    title,
    detail,
    source: scheme,
    marks,
  });

  switch (a.status) {
    case "certified": {
      const named = a.certifications.filter((c) => c.agencyId);
      const trusted = named.filter((c) => accepted.includes(c.agencyId!));
      if (trusted.length) {
        return finding(
          "good",
          `${name}: certified by ${trusted.map((c) => c.agencyName).join(", ")}`,
          "A certifier you accept is listed for this product. Check the symbol on the package.",
        );
      }
      const agencies = scheme === "kosher" ? KOSHER_AGENCIES : HALAL_AGENCIES;
      const yours =
        agencies
          .filter((x) => accepted.includes(x.id))
          .map((x) => x.label)
          .join(", ") || "none selected";
      return finding(
        "caution",
        `${name}: certifier not on your list`,
        `Certified by ${named.map((c) => c.agencyName).join(", ") || "an unknown agency"}. You accept: ${yours}.`,
      );
    }
    case "forbidden_ingredient":
      return finding("avoid", `Conflicts with ${scheme} rules`, a.summary);
    case "conflicting_data":
      return finding("not_sure", `${name}: information conflicts`, `${a.summary} Check the package.`);
    case "doubtful_ingredient":
      return finding(doubtful, `${name}: unclear ingredients`, a.summary);
    case "not_certified":
      return finding(doubtful, `No ${scheme} certification found`, a.summary);
    case "no_listed_conflicts":
      return finding("good", `${name}: no listed conflicts`, a.summary);
    case "insufficient_data":
    default:
      return finding("not_sure", `${name}: not enough information`, a.summary);
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does a mark's term appear in this ingredient row as whole words? ("bacon" in "bacon bits") */
function matches(row: string, term: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(lower(term))}([^\\p{L}\\p{N}]|$)`, "u").test(lower(row));
}

/** Tag for one row of "Ingredients checked": the most severe mark on it, or "OK". */
export function ingredientTag(ingredient: string, verdict: Verdict): { text: string; level: Level } {
  let best: IngredientMark | undefined;
  for (const f of verdict.findings) {
    for (const m of f.marks) {
      if (matches(ingredient, m.match) && (!best || LEVEL_RANK[m.level] > LEVEL_RANK[best.level])) best = m;
    }
  }
  return best && best.level !== "good" ? { text: best.text, level: best.level } : { text: "OK", level: "good" };
}

export const LEVEL_TEXT: Record<Level, { eyebrow: string; tag: string; fallbackHeadline: string }> = {
  avoid: { eyebrow: "Not a match for you", tag: "Avoid", fallbackHeadline: "Avoid" },
  caution: { eyebrow: "Check before eating", tag: "Caution", fallbackHeadline: "Caution" },
  not_sure: { eyebrow: "Not sure", tag: "Not sure", fallbackHeadline: "Sift can't tell" },
  good: {
    eyebrow: "No listed conflicts",
    tag: "OK",
    fallbackHeadline: "Nothing on the label conflicts with your restrictions",
  },
};
