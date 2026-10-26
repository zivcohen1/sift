import { enrichProduct, type EnrichedProduct, type SourceName, type SourceProductLike } from "../enrich/fromSource";

/** Cache lifetimes from the design document (Table 9). */
export const TTL_PRODUCT_SECONDS = 7 * 24 * 60 * 60;
export const TTL_MISS_SECONDS = 24 * 60 * 60;

/** The slice of Cloudflare Workers KV that the lookup uses. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface RawProduct extends SourceProductLike {
  barcode: string;
  name?: string;
  brand?: string;
  sourceUrl?: string;
}

/**
 * The readers are injected, so this file imports neither source reader and works with
 * the existing openFoodFacts.ts and usda.ts unchanged. Wire them like this:
 *   fetchOff:  (b) => fetchOffProduct(b, USER_AGENT)
 *   fetchUsda: (b) => fetchUsdaByBarcode(b, env.USDA_API_KEY)
 */
export interface LookupDeps {
  kv?: KvLike;
  isValidBarcode(code: string): boolean;
  fetchOff(barcode: string): Promise<RawProduct | null>;
  fetchUsda(barcode: string): Promise<RawProduct | null>;
}

export type LookupResult =
  | {
      kind: "found";
      barcode: string;
      sources: SourceName[];
      product: RawProduct;
      enriched: EnrichedProduct;
      fromCache: boolean;
    }
  | { kind: "not_found"; next: "scan_label" }
  | { kind: "sources_unavailable"; next: "scan_label" }
  | { kind: "invalid_barcode" };

interface CachedRecord {
  off: RawProduct | null;
  usda: RawProduct | null;
}

type Attempt = { ok: true; value: RawProduct | null } | { ok: false };

/**
 * Any error from a reader counts as "source unavailable". The barcode is validated first,
 * so a reader has no other reason to throw, and this also works when the two readers
 * define separate error classes.
 */
async function attempt(fn: () => Promise<RawProduct | null>): Promise<Attempt> {
  try {
    return { ok: true, value: await fn() };
  } catch {
    return { ok: false };
  }
}

/** Cache problems never break a scan (Table 3: KV is best-effort). */
async function kvGet(kv: KvLike | undefined, key: string): Promise<string | null> {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch {
    return null;
  }
}
async function kvPut(kv: KvLike | undefined, key: string, value: string, ttl: number): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(key, value, { expirationTtl: ttl });
  } catch {
    /* ignored on purpose */
  }
}

/** Open Food Facts is the base record; USDA fills a missing ingredient list or nutrition panel. */
export function mergeSources(
  off: RawProduct | null,
  usda: RawProduct | null,
): { product: RawProduct; sources: SourceName[] } | null {
  const base = off ?? usda;
  if (!base) return null;
  const sources: SourceName[] = [off ? "open_food_facts" : "usda"];
  const product: RawProduct = { ...base };

  if (off && usda) {
    let filled = false;
    if (!product.ingredientsText && usda.ingredientsText) {
      product.ingredientsText = usda.ingredientsText;
      filled = true;
    }
    if (!product.nutrition && usda.nutrition) {
      product.nutrition = usda.nutrition;
      filled = true;
    }
    if (filled) sources.push("usda");
  }
  return { product, sources };
}

function build(barcode: string, record: CachedRecord, fromCache: boolean): LookupResult | null {
  const merged = mergeSources(record.off, record.usda);
  if (!merged) return null;
  const origin: SourceName = record.off ? "open_food_facts" : "usda";
  return {
    kind: "found",
    barcode,
    sources: merged.sources,
    product: merged.product,
    enriched: enrichProduct(merged.product, origin),
    fromCache,
  };
}

/**
 * Scan workflow, step 2 (Section 4.1): KV cache, then Open Food Facts, then USDA.
 *
 * - The raw source record is cached, never the enriched result, so a knowledge-base
 *   fix takes effect immediately.
 * - A result is cached only when no source failed. Outages are never cached, so the
 *   next scan retries.
 * - "Not found" is cached for a day, but only when every source answered.
 */
export async function lookupProduct(barcode: string, deps: LookupDeps): Promise<LookupResult> {
  if (!deps.isValidBarcode(barcode)) return { kind: "invalid_barcode" };

  const cachedRaw = await kvGet(deps.kv, `src:v1:${barcode}`);
  if (cachedRaw) {
    try {
      const hit = build(barcode, JSON.parse(cachedRaw) as CachedRecord, true);
      if (hit) return hit;
    } catch {
      /* corrupt cache entry: fall through and fetch live */
    }
  }
  if (await kvGet(deps.kv, `miss:v1:${barcode}`)) return { kind: "not_found", next: "scan_label" };

  const off = await attempt(() => deps.fetchOff(barcode));
  const offValue = off.ok ? off.value : null;

  const needUsda = !off.ok || !offValue || !offValue.ingredientsText || !offValue.nutrition;
  const usda: Attempt = needUsda ? await attempt(() => deps.fetchUsda(barcode)) : { ok: true, value: null };
  const usdaValue = usda.ok ? usda.value : null;

  const record: CachedRecord = { off: offValue, usda: usdaValue };
  const result = build(barcode, record, false);
  const anySourceDown = !off.ok || !usda.ok;

  if (result) {
    if (!anySourceDown) await kvPut(deps.kv, `src:v1:${barcode}`, JSON.stringify(record), TTL_PRODUCT_SECONDS);
    return result;
  }
  if (anySourceDown) return { kind: "sources_unavailable", next: "scan_label" };

  await kvPut(deps.kv, `miss:v1:${barcode}`, "1", TTL_MISS_SECONDS);
  return { kind: "not_found", next: "scan_label" };
}
