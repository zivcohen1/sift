/**
 * Sift: USDA FoodData Central reader.
 *
 * Searches USDA's "Branded Foods" data by barcode. We use it when Open Food Facts
 * has a product but no nutrition panel, or does not know the barcode at all.
 * USDA records include the label's ingredient list and nutrients per 100 g.
 *
 * Needs sourceErrors.ts in the same folder.
 * Needs a free key from https://api.data.gov/signup/ ("DEMO_KEY" works for a few tests).
 */

import { SourceUnavailableError } from "./sourceErrors";

export { SourceUnavailableError };

export interface UsdaProduct {
  barcode: string;
  fdcId: number;
  name?: string;
  brand?: string;
  ingredientsText?: string;
  nutrition: { basis: "per_100g"; values: Record<string, number> } | null;
  servingSize?: string;
  sourceUrl: string;
}

const BASE_URL = "https://api.nal.usda.gov/fdc/v1";
const TIMEOUT_MS = 6000;

/** FoodData Central nutrient id -> our key. The suffix says which unit we store. */
const NUTRIENTS: Record<number, string> = {
  1008: "energy_kcal",
  1004: "fat_g",
  1258: "saturated_fat_g",
  1005: "carbohydrates_g",
  2000: "sugars_g",
  1235: "added_sugars_g",
  1079: "fiber_g",
  1003: "protein_g",
  1093: "sodium_mg",
  1092: "potassium_mg",
  1091: "phosphorus_mg",
  1087: "calcium_mg",
};

interface UsdaFood {
  fdcId: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: Array<{ nutrientId?: number; unitName?: string; value?: number }>;
}

/** USDA stores "049000028911" where Open Food Facts may store "0049000028911". */
const sameBarcode = (a: string, b: string) => a.replace(/^0+/, "") === b.replace(/^0+/, "");

/** Convert USDA's unit (G, MG, UG, KCAL, KJ) to the unit our key ends with. */
function convert(key: string, value: number, unit: string): number | null {
  const u = unit.toUpperCase();
  if (key === "energy_kcal") return u === "KCAL" ? value : u === "KJ" ? value / 4.184 : null;
  const grams = u === "G" ? value : u === "MG" ? value / 1000 : u === "UG" ? value / 1e6 : null;
  if (grams === null) return null;
  return key.endsWith("_mg") ? grams * 1000 : grams;
}

function readNutrition(food: UsdaFood): UsdaProduct["nutrition"] {
  const values: Record<string, number> = {};
  for (const n of food.foodNutrients ?? []) {
    const key = n.nutrientId !== undefined ? NUTRIENTS[n.nutrientId] : undefined;
    // Skip null or non-numeric values rather than reading them as zero.
    if (!key || typeof n.value !== "number" || !n.unitName) continue;
    const v = convert(key, n.value, n.unitName);
    if (v !== null) values[key] = Math.round(v * 1000) / 1000;
  }
  return Object.keys(values).length ? { basis: "per_100g", values } : null;
}

/** Returns the USDA record whose barcode matches exactly, or null. */
export async function fetchUsdaByBarcode(
  barcode: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<UsdaProduct | null> {
  const params = new URLSearchParams({
    api_key: apiKey,
    query: barcode,
    dataType: "Branded",
    pageSize: "5",
  });

  // The timer covers the whole request, including reading the body, so a stalled body
  // cannot hang a scan. It is cleared only after the last read finishes.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetchFn(`${BASE_URL}/foods/search?${params}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      throw new SourceUnavailableError(`USDA request failed: ${(err as Error).message}`);
    }
    if (res.status === 429 || res.status === 503)
      throw new SourceUnavailableError("Rate limited by USDA", res.status);
    if (!res.ok) throw new SourceUnavailableError(`USDA HTTP ${res.status}`, res.status);

    let body: { foods?: UsdaFood[] };
    try {
      body = (await res.json()) as { foods?: UsdaFood[] };
    } catch (err) {
      throw new SourceUnavailableError(`USDA sent a bad response: ${(err as Error).message}`);
    }

    // The search is full-text and can return near-misses, so only accept an exact barcode match.
    const food = (body.foods ?? []).find((f) => f.gtinUpc && sameBarcode(f.gtinUpc, barcode));
    if (!food) return null;

    return {
      barcode,
      fdcId: food.fdcId,
      name: food.description,
      brand: food.brandName ?? food.brandOwner,
      ingredientsText: food.ingredients,
      nutrition: readNutrition(food),
      servingSize:
        food.householdServingFullText ??
        (food.servingSize ? `${food.servingSize} ${food.servingSizeUnit ?? ""}`.trim() : undefined),
      sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---- Run directly to try it: npx tsx usda.ts <barcode> ---- */
const proc = (globalThis as any).process;
if (proc?.argv?.[1]?.endsWith("usda.ts")) {
  const barcode = proc.argv[2] ?? "049000028911";
  fetchUsdaByBarcode(barcode, proc.env.USDA_API_KEY ?? "DEMO_KEY")
    .then((p) => console.log(p ? JSON.stringify(p, null, 2) : `${barcode}: no exact match in USDA`))
    .catch((err) => console.error("Error:", err.message));
}
