/**
 * Sift: Open Food Facts reader (standalone, no other files needed).
 *
 * Looks a barcode up in Open Food Facts, the free, open product database, and
 * returns the parts Sift needs: ingredients, allergen tags, label tags (this is
 * where kosher / halal certifications appear) and nutrition per 100 g.
 *
 * Try it (Windows PowerShell, macOS or Linux, Node 20+):
 *   npx tsx openFoodFacts.ts 3017620422003
 *
 * Rules from the Open Food Facts API docs:
 *   - send a User-Agent "AppName/Version (ContactEmail)"
 *   - at most 15 product reads per minute per IP (the backend will cache results)
 */

export interface Nutrition {
  basis: "per_100g";
  values: Record<string, number>; // energy_kcal, sugars_g, sodium_mg, ...
}

export interface FoodProduct {
  barcode: string;
  name?: string;
  brand?: string;
  imageUrl?: string;
  ingredientsText?: string;
  labelsText?: string; // free text, e.g. "Kosher, OU-D, Gluten-free"
  allergenTags: string[]; // e.g. ["en:milk", "en:gluten"]
  traceTags: string[]; // "may contain", e.g. ["en:peanuts"]
  labelTags: string[]; // e.g. ["en:kosher", "en:halal", "en:gluten-free"]
  additiveTags: string[]; // e.g. ["en:e322"]
  nutrition: Nutrition | null;
  servingSize?: string;
  sourceUrl: string;
}

/** The database is down, slow or rate-limiting us. The app should fall back to a label photo. */
export class SourceUnavailableError extends Error {
  constructor(
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
  }
}

const BASE_URL = "https://world.openfoodfacts.org";
const TIMEOUT_MS = 6000;

/** Only ask for the fields we use: smaller responses, faster scans. */
const FIELDS = [
  "code",
  "product_name",
  "product_name_en",
  "brands",
  "image_front_url",
  "ingredients_text",
  "ingredients_text_en",
  "allergens_tags",
  "traces_tags",
  "labels",
  "labels_tags",
  "additives_tags",
  "nutriments",
  "serving_size",
];

/** Open Food Facts key (per 100 g) -> our key, and the factor to reach our unit (OFF stores minerals in grams). */
const NUTRIENTS: Array<[string, string, number]> = [
  ["energy-kcal_100g", "energy_kcal", 1],
  ["fat_100g", "fat_g", 1],
  ["saturated-fat_100g", "saturated_fat_g", 1],
  ["carbohydrates_100g", "carbohydrates_g", 1],
  ["sugars_100g", "sugars_g", 1],
  ["fiber_100g", "fiber_g", 1],
  ["proteins_100g", "protein_g", 1],
  ["salt_100g", "salt_g", 1],
  ["sodium_100g", "sodium_mg", 1000],
  ["potassium_100g", "potassium_mg", 1000],
  ["phosphorus_100g", "phosphorus_mg", 1000],
];

/** Barcodes end in a check digit, so camera misreads can be rejected before any API call. */
export function isValidBarcode(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const list = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function readNutrition(nutriments: Record<string, unknown> | undefined): Nutrition | null {
  if (!nutriments) return null;
  const values: Record<string, number> = {};
  for (const [offKey, key, factor] of NUTRIENTS) {
    const n = Number(nutriments[offKey]);
    if (nutriments[offKey] !== undefined && Number.isFinite(n)) {
      values[key] = Math.round(n * factor * 1000) / 1000;
    }
  }
  return Object.keys(values).length ? { basis: "per_100g", values } : null;
}

/** Kosher / halal label tags on a product, e.g. ["en:kosher", "en:islamic-food-and-nutrition-council-of-america"]. */
export function certificationTags(p: FoodProduct): { kosher: string[]; halal: string[] } {
  return {
    kosher: p.labelTags.filter((t) => /kosher|casher|koscher|orthodox-union|star-k|kof-k/.test(t)),
    halal: p.labelTags.filter((t) => /halal|ifanca|islamic-food|muslim/.test(t)),
  };
}

/**
 * Look a barcode up. Returns the product, or null if Open Food Facts does not know it
 * (then the app asks the user to photograph the ingredient list).
 */
export async function fetchOffProduct(
  barcode: string,
  userAgent: string,
  fetchFn: typeof fetch = fetch,
): Promise<FoodProduct | null> {
  if (!isValidBarcode(barcode)) throw new Error(`Not a valid barcode: ${barcode}`);
  const url = `${BASE_URL}/api/v3/product/${barcode}.json?fields=${FIELDS.join(",")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    throw new SourceUnavailableError(`Open Food Facts request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (res.status === 429 || res.status === 503) {
    throw new SourceUnavailableError("Rate limited by Open Food Facts", res.status);
  }
  if (!res.ok) throw new SourceUnavailableError(`Open Food Facts HTTP ${res.status}`, res.status);

  const body = (await res.json()) as Record<string, unknown>;
  const p = body.product as Record<string, unknown> | undefined;
  // API v3 answers status "success"; the older v2 answers status 1.
  const found =
    !!p &&
    (body.status === "success" || body.status === "success_with_warnings" || body.status === 1);
  if (!found) return null;

  return {
    barcode: text(p!.code) ?? barcode,
    name: text(p!.product_name_en) ?? text(p!.product_name),
    brand: text(p!.brands),
    imageUrl: text(p!.image_front_url),
    ingredientsText: text(p!.ingredients_text_en) ?? text(p!.ingredients_text),
    labelsText: text(p!.labels),
    allergenTags: list(p!.allergens_tags),
    traceTags: list(p!.traces_tags),
    labelTags: list(p!.labels_tags),
    additiveTags: list(p!.additives_tags),
    nutrition: readNutrition(p!.nutriments as Record<string, unknown> | undefined),
    servingSize: text(p!.serving_size),
    sourceUrl: `${BASE_URL}/product/${barcode}`,
  };
}

/* ---- Run directly to try it: npx tsx openFoodFacts.ts <barcode> ---- */
const proc = (globalThis as any).process;
if (proc?.argv?.[1]?.endsWith("openFoodFacts.ts")) {
  const barcode = proc.argv[2] ?? "3017620422003";
  fetchOffProduct(barcode, "Sift/0.1.0 (CHANGE_ME@example.com)")
    .then((p) => {
      if (!p)
        return console.log(`${barcode}: not in Open Food Facts -> app would ask for a label photo`);
      console.log(JSON.stringify({ ...p, certifications: certificationTags(p) }, null, 2));
    })
    .catch((err) => console.error("Error:", err.message));
}
