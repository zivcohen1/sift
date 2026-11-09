import { describe, expect, it } from "vitest";
import { lookupBarcode } from "./api";
import { cleanTypedCode, isValidBarcode, normalizeScannedCode } from "./barcode";
import { addToHistory, loadHistory } from "./history";
import { DEFAULT_PROFILE, loadProfile, saveProfile, toggle } from "./profile";
import type { KeyValueStore } from "./storage";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("profile storage (this browser only)", () => {
  it("returns the default profile the first time", () => {
    expect(loadProfile(memoryStore())).toEqual(DEFAULT_PROFILE);
  });

  it("saves and loads", () => {
    const store = memoryStore();
    saveProfile({ ...DEFAULT_PROFILE, avoid: ["dairy"], doubtfulPolicy: "avoid" }, store);
    expect(loadProfile(store)).toMatchObject({ avoid: ["dairy"], doubtfulPolicy: "avoid" });
  });

  it("survives corrupted or blocked storage", () => {
    const store = memoryStore();
    store.setItem("sift.profile.v1", "{not json");
    expect(loadProfile(store)).toEqual(DEFAULT_PROFILE);
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(loadProfile(blocked)).toEqual(DEFAULT_PROFILE);
    expect(saveProfile(DEFAULT_PROFILE, blocked)).toBe(false);
  });

  it("toggle adds and removes", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("history", () => {
  it("keeps the newest scan first and one entry per barcode", () => {
    const store = memoryStore();
    const e = (barcode: string, savedAt: string) => ({ barcode, level: "good" as const, headline: "x", savedAt });
    addToHistory(e("1", "2026-11-01"), store);
    addToHistory(e("2", "2026-11-02"), store);
    addToHistory(e("1", "2026-11-03"), store);
    expect(loadHistory(store).map((h) => h.barcode)).toEqual(["1", "2"]);
  });
});

describe("barcodes", () => {
  it("uses the same check-digit test as the API", () => {
    expect(isValidBarcode("3017620422003")).toBe(true);
    expect(isValidBarcode("3017620422004")).toBe(false);
  });

  it("expands UPC-E codes from small packs to UPC-A", () => {
    const upca = normalizeScannedCode("04252614", "UPC_E");
    expect(upca).toBe("042100005264");
    expect(isValidBarcode(upca)).toBe(true);
    expect(normalizeScannedCode("04252614", "OTHER")).toBe("04252614");
  });

  it("cleans typed input", () => {
    expect(cleanTypedCode(" 3017 6204-22003 ")).toBe("3017620422003");
  });
});

describe("lookupBarcode", () => {
  const respond = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("maps the API's answers", async () => {
    expect((await lookupBarcode("1", respond(404, { error: "not_found" }), "")).kind).toBe("not_found");
    expect((await lookupBarcode("1", respond(400, { error: "invalid_barcode" }), "")).kind).toBe("invalid_barcode");
    expect((await lookupBarcode("1", respond(503, {}), "")).kind).toBe("unavailable");
    const found = await lookupBarcode("1", respond(200, { barcode: "1" }), "");
    expect(found.kind).toBe("found");
  });

  it("treats a network or CORS failure as unavailable", async () => {
    const fail = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect((await lookupBarcode("1", fail, "")).kind).toBe("unavailable");
  });
});
