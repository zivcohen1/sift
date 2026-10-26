import { describe, expect, it } from "vitest";
import {
  lookupProduct, mergeSources, TTL_MISS_SECONDS, TTL_PRODUCT_SECONDS,
  type KvLike, type RawProduct,
} from "../src/product/lookup";

const BARCODE = "3017620422003";

class FakeKv implements KvLike {
  store = new Map<string, string>();
  ttls = new Map<string, number | undefined>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async put(key: string, value: string, o?: { expirationTtl?: number }) {
    this.store.set(key, value);
    this.ttls.set(key, o?.expirationTtl);
  }
}

const nutrition = { basis: "per_100g" as const, values: { sodium_mg: 100 } };
const full: RawProduct = { barcode: BARCODE, name: "Spread", ingredientsText: "sugar, whey", nutrition };

type Answer = RawProduct | null | "down" | undefined;

function harness(opts: { off?: Answer; usda?: Answer; kv?: KvLike } = {}) {
  const calls = { off: 0, usda: 0 };
  const reader = (which: "off" | "usda", v: Answer) => async () => {
    calls[which]++;
    if (v === "down") throw new Error("down");
    return v ?? null;
  };
  return {
    calls,
    deps: {
      kv: opts.kv,
      isValidBarcode: () => true,
      fetchOff: reader("off", opts.off),
      fetchUsda: reader("usda", opts.usda),
    },
  };
}

describe("lookupProduct", () => {
  it("rejects an invalid barcode before any call", async () => {
    const h = harness({ off: full });
    expect(await lookupProduct("123", { ...h.deps, isValidBarcode: () => false })).toEqual({ kind: "invalid_barcode" });
    expect(h.calls).toEqual({ off: 0, usda: 0 });
  });

  it("uses only Open Food Facts when the record is complete", async () => {
    const h = harness({ off: full });
    const r = await lookupProduct(BARCODE, h.deps);
    expect(r.kind === "found" && r.sources).toEqual(["open_food_facts"]);
    expect(h.calls).toEqual({ off: 1, usda: 0 });
  });

  it("fills a missing nutrition panel from USDA", async () => {
    const h = harness({ off: { ...full, nutrition: null }, usda: { barcode: BARCODE, nutrition } });
    const r = await lookupProduct(BARCODE, h.deps);
    expect(r.kind === "found" && r.sources).toEqual(["open_food_facts", "usda"]);
    expect(r.kind === "found" && r.enriched.nutrientsPer100g.sodium_mg).toBe(100);
  });

  it("falls back to USDA when Open Food Facts does not know the barcode", async () => {
    const h = harness({ off: null, usda: { barcode: BARCODE, ingredientsText: "SUGAR, MILK", nutrition } });
    const r = await lookupProduct(BARCODE, h.deps);
    expect(r.kind === "found" && r.sources).toEqual(["usda"]);
  });

  it("returns not_found and caches the miss for one day when every source answered", async () => {
    const kv = new FakeKv();
    const h = harness({ off: null, usda: null, kv });
    expect(await lookupProduct(BARCODE, h.deps)).toEqual({ kind: "not_found", next: "scan_label" });
    expect(kv.ttls.get(`miss:v1:${BARCODE}`)).toBe(TTL_MISS_SECONDS);
    await lookupProduct(BARCODE, h.deps);
    expect(h.calls).toEqual({ off: 1, usda: 1 });          // second scan served from the miss marker
  });

  it("never caches an outage, and reports sources_unavailable", async () => {
    const kv = new FakeKv();
    const h = harness({ off: "down", usda: "down", kv });
    expect(await lookupProduct(BARCODE, h.deps)).toEqual({ kind: "sources_unavailable", next: "scan_label" });
    expect(kv.store.size).toBe(0);
  });

  it("does not cache a miss when one source was down", async () => {
    const kv = new FakeKv();
    const h = harness({ off: "down", usda: null, kv });
    expect((await lookupProduct(BARCODE, h.deps)).kind).toBe("sources_unavailable");
    expect(kv.store.size).toBe(0);
  });

  it("returns a USDA result when Open Food Facts is down, without caching it", async () => {
    const kv = new FakeKv();
    const h = harness({ off: "down", usda: { barcode: BARCODE, ingredientsText: "sugar", nutrition }, kv });
    expect((await lookupProduct(BARCODE, h.deps)).kind).toBe("found");
    expect(kv.store.size).toBe(0);
  });

  it("does not pin a partial record when USDA was needed but down", async () => {
    const kv = new FakeKv();
    const h = harness({ off: { ...full, nutrition: null }, usda: "down", kv });
    const r = await lookupProduct(BARCODE, h.deps);
    expect(r.kind).toBe("found");
    expect(kv.store.size).toBe(0);
  });

  it("caches the raw record for 7 days and serves the second scan from cache", async () => {
    const kv = new FakeKv();
    const h = harness({ off: full, kv });
    await lookupProduct(BARCODE, h.deps);
    expect(kv.ttls.get(`src:v1:${BARCODE}`)).toBe(TTL_PRODUCT_SECONDS);
    const second = await lookupProduct(BARCODE, h.deps);
    expect(second.kind === "found" && second.fromCache).toBe(true);
    expect(h.calls.off).toBe(1);
  });

  it("stores the raw record, not the enriched result", async () => {
    const kv = new FakeKv();
    await lookupProduct(BARCODE, harness({ off: full, kv }).deps);
    expect(Object.keys(JSON.parse(kv.store.get(`src:v1:${BARCODE}`)!))).toEqual(["off", "usda"]);
  });

  it("keeps working when the cache throws", async () => {
    const broken: KvLike = {
      get: async () => { throw new Error("kv"); },
      put: async () => { throw new Error("kv"); },
    };
    expect((await lookupProduct(BARCODE, harness({ off: full, kv: broken }).deps)).kind).toBe("found");
  });

  it("ignores a corrupt cache entry and fetches live", async () => {
    const kv = new FakeKv();
    kv.store.set(`src:v1:${BARCODE}`, "{not json");
    const h = harness({ off: full, kv });
    expect((await lookupProduct(BARCODE, h.deps)).kind).toBe("found");
    expect(h.calls.off).toBe(1);
  });
});

describe("mergeSources", () => {
  it("returns null when neither source has the product", () => {
    expect(mergeSources(null, null)).toBeNull();
  });
  it("does not overwrite fields Open Food Facts already has", () => {
    const m = mergeSources(full, {
      barcode: BARCODE, ingredientsText: "OTHER", nutrition: { basis: "per_100g", values: { sodium_mg: 1 } },
    });
    expect(m?.product.ingredientsText).toBe("sugar, whey");
    expect(m?.product.nutrition?.values.sodium_mg).toBe(100);
    expect(m?.sources).toEqual(["open_food_facts"]);
  });
});
