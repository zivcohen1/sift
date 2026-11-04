import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { handle, type Env } from "../src/worker";

const BARCODE = "3017620422003"; // valid check digit, used in openFoodFacts.ts examples

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** In-memory stand-in for Workers KV. */
function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
  };
}

const offProduct = {
  status: "success",
  product: {
    code: BARCODE,
    product_name: "Test cereal",
    brands: "Acme",
    ingredients_text: "oats, sugar",
    labels_tags: ["en:kosher"],
    allergens_tags: ["en:gluten"],
    nutriments: { "energy-kcal_100g": 380, "sodium_100g": 0.2 },
  },
};

const env = (kv?: ReturnType<typeof memoryKv>): Env => ({
  PRODUCT_CACHE: kv,
  USDA_API_KEY: "test-key",
  USER_AGENT: "Sift/test (test@example.com)",
});

const get = (path: string) => new Request(`https://api.test${path}`, { method: "GET" });

afterEach(() => vi.unstubAllGlobals());

describe("GET /v1/product/{barcode}", () => {
  it("returns the product when Open Food Facts has it, and caches it", async () => {
    const fetchMock = vi.fn(async () => json(200, offProduct));
    vi.stubGlobal("fetch", fetchMock);
    const kv = memoryKv();

    const res = await handle(get(`/v1/product/${BARCODE}`), env(kv));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.barcode).toBe(BARCODE);
    expect(body.sources).toEqual(["open_food_facts"]);
    expect(body.fromCache).toBe(false);
    expect(body.enriched.nutrientsPer100g.energy_kcal).toBe(380);
    expect(kv.store.has(`src:v1:${BARCODE}`)).toBe(true);

    // second scan is served from the cache, not the network
    fetchMock.mockClear();
    const again = await (await handle(get(`/v1/product/${BARCODE}`), env(kv))).json();
    expect(again.fromCache).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 404 with next=scan_label when no source knows the barcode", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("openfoodfacts") ? json(404, {}) : json(200, { foods: [] })));
    const res = await handle(get(`/v1/product/${BARCODE}`), env(memoryKv()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", next: "scan_label" });
  });

  it("answers 503 when a source is down, and does not cache the outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(503, {})));
    const kv = memoryKv();
    const res = await handle(get(`/v1/product/${BARCODE}`), env(kv));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "sources_unavailable", next: "scan_label" });
    expect(kv.store.size).toBe(0);
  });

  it("rejects a barcode that fails the check digit before calling any source", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await handle(get("/v1/product/3017620422004"), env());
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown paths, 405 for non-GET, 500 when not configured", async () => {
    expect((await handle(get("/v1/nope"), env())).status).toBe(404);
    const post = new Request(`https://api.test/v1/product/${BARCODE}`, { method: "POST" });
    expect((await handle(post, env())).status).toBe(405);
    expect((await handle(get(`/v1/product/${BARCODE}`), { ...env(), USDA_API_KEY: "" })).status).toBe(500);
  });

  it("is wired as the default Worker export", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("openfoodfacts") ? json(404, {}) : json(200, { foods: [] })));
    const res = await worker.fetch(get(`/v1/product/${BARCODE}`), env(memoryKv()));
    expect(res.status).toBe(404);
  });
});
