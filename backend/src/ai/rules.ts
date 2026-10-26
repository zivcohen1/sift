import { z } from "zod";

/** Rule kinds the app's rule engine understands. */
export const RULE_KINDS = ["avoidCategory", "avoidIngredient", "nutrientLimit"] as const;

const DraftSchema = z.object({
  kind: z.enum(RULE_KINDS),
  categoryId: z.string().trim().min(1).optional(),
  ingredient: z.string().trim().min(1).max(100).optional(),
  nutrient: z.string().trim().min(1).max(50).optional(),
  maxPer100g: z.number().finite().positive().optional(),
  restriction: z.string().trim().max(200).optional(),
  explanation: z.string().trim().max(400).optional(),
});

export interface DraftRule {
  kind: (typeof RULE_KINDS)[number];
  categoryId?: string;
  ingredient?: string;
  nutrient?: string;
  maxPer100g?: number;
  restriction?: string;
  explanation: string;
  /** Always null here: a person must approve a draft before it can affect a verdict. */
  approvedAt: null;
}

export interface SanitizedDrafts {
  rules: DraftRule[];
  dropped: number;
  needsClinicianReview: boolean;
}

function complete(d: z.infer<typeof DraftSchema>, known: ReadonlySet<string>): boolean {
  switch (d.kind) {
    case "avoidCategory": return !!d.categoryId && known.has(d.categoryId);
    case "avoidIngredient": return !!d.ingredient;
    case "nutrientLimit": return !!d.nutrient && d.maxPer100g !== undefined;
  }
}

/**
 * Validate AI-drafted rules (Section 6.1). Each draft is checked on its own, so one bad
 * rule never discards the rest. A category the knowledge base does not have is dropped
 * rather than invented. Clinician review is required unless MedlinePlus answered AND the
 * model said review is not needed. Every draft comes back unapproved.
 */
export function sanitizeDraftRules(
  raw: unknown,
  opts: { knownCategoryIds: Iterable<string>; medlinePlusAvailable: boolean },
): SanitizedDrafts {
  const known = new Set(opts.knownCategoryIds);
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.rules) ? obj.rules : [];

  const rules: DraftRule[] = [];
  let dropped = 0;
  for (const entry of list) {
    const parsed = DraftSchema.safeParse(entry);
    if (!parsed.success || !complete(parsed.data, known)) {
      dropped++;
      continue;
    }
    const { explanation, ...rest } = parsed.data;
    rules.push({ ...rest, explanation: explanation ?? "", approvedAt: null });
  }

  const modelSaysReview = obj.needsClinicianReview === false ? false : true;
  return {
    rules,
    dropped,
    needsClinicianReview: !opts.medlinePlusAvailable || modelSaysReview,
  };
}
