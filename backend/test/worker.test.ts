import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { handle, MAX_BODY_BYTES, type Env } from "../src/worker";

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
const post = (path: string, body: string) =>
  new Request(`https://api.test${path}`, { method: "POST", body, headers: { "content-type": "application/json" } });

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
    const postReq = new Request(`https://api.test/v1/product/${BARCODE}`, { method: "POST" });
    expect((await handle(postReq, env())).status).toBe(405);
    expect((await handle(get(`/v1/product/${BARCODE}`), { ...env(), USDA_API_KEY: "" })).status).toBe(500);
  });

  it("is wired as the default Worker export", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("openfoodfacts") ? json(404, {}) : json(200, { foods: [] })));
    const res = await worker.fetch(get(`/v1/product/${BARCODE}`), env(memoryKv()));
    expect(res.status).toBe(404);
  });
});

describe("no app key", () => {
  it("answers the website without any key header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, offProduct)));
    const res = await handle(get(`/v1/product/${BARCODE}`), env(memoryKv()));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await handle(get("/v1/reference"), env())).status).toBe(200);
    expect((await handle(get("/health"), env())).status).toBe(200);
  });
});

describe("GET /health", () => {
  it("reports liveness and the knowledge-base version", async () => {
    const res = await handle(get("/health"), env());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.kbVersion).toBe("string");
  });
});

describe("GET /v1/reference", () => {
  it("lists categories and the agencies the evidence readers recognise", async () => {
    const res = await handle(get("/v1/reference"), env());
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.categories.map((c: { id: string }) => c.id);
    expect(ids).toContain("dairy");
    expect(ids).toContain("wheat");
    for (const c of body.categories) expect(Object.keys(c).sort()).toEqual(["id", "label"]);
    expect(body.kosherAgencies.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining(["ou", "star-k", "kof-k", "ok", "crc"]));
    expect(body.halalCertifiers.map((a: { id: string }) => a.id)).toEqual(["ifanca"]);
    // no duplicates even though OU appears in both the tag and the mark tables
    expect(new Set(body.kosherAgencies.map((a: { id: string }) => a.id)).size).toBe(body.kosherAgencies.length);
  });
});

describe("POST /v1/ingredients/analyze", () => {
  const analyze = (body: unknown) => handle(post("/v1/ingredients/analyze", JSON.stringify(body)), env());

  it("enriches label text through the same path as a barcode scan", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await analyze({ ingredientText: "Cocoa butter, sugar, whey, natural flavors. May contain peanuts." });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("label_photo");
    const hits = body.enriched.facts.categoryHits;
    expect(hits).toContainEqual(expect.objectContaining({ categoryId: "dairy", ingredient: "whey", certainty: "definite" }));
    // cocoa butter is not dairy
    expect(hits.some((h: { ingredient: string }) => h.ingredient === "cocoa butter")).toBe(false);
    // a May contain hit is never more than possible
    for (const h of hits.filter((x: { fromMayContain: boolean }) => x.fromMayContain)) expect(h.certainty).toBe("possible");
    expect(body.enriched.facts.ambiguous.length).toBeGreaterThan(0);
    expect(body.enriched.warnings).toContain("no_nutrition_data");
    expect(body.enriched.warnings).not.toContain("crowd_sourced_check_the_package");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a kosher mark from the package text", async () => {
    const body = await (await analyze({ ingredientText: "sugar, cocoa", packageText: "OU-D" })).json();
    expect(body.enriched.religious.kosher.status).toBe("certified");
  });

  it("never treats a product as kosher without a recognised agency", async () => {
    const body = await (await analyze({ ingredientText: "sugar, cocoa", packageText: "kosher" })).json();
    expect(body.enriched.religious.kosher.status).toBe("not_certified");
  });

  it("rejects bad JSON and bad fields without echoing the submitted text", async () => {
    const badJson = await handle(post("/v1/ingredients/analyze", "{not json"), env());
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: "invalid_json" });

    for (const bad of [{}, { ingredientText: "   " }, { ingredientText: 42 }, { ingredientText: "x".repeat(8001) }]) {
      const res = await analyze(bad);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_request");
      expect(body.fields).toEqual(["ingredientText"]);
      expect(JSON.stringify(body)).not.toContain("xxxx");
    }
  });

  it("rejects bodies over the size limit", async () => {
    const big = JSON.stringify({ ingredientText: "a".repeat(MAX_BODY_BYTES) });
    expect((await handle(post("/v1/ingredients/analyze", big), env())).status).toBe(413);
  });

  it("only accepts POST", async () => {
    const res = await handle(get("/v1/ingredients/analyze"), env());
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

describe("CORS preflight", () => {
  it("lets the website send JSON", async () => {
    const res = await handle(new Request("https://api.test/v1/ingredients/analyze", { method: "OPTIONS" }), env());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
