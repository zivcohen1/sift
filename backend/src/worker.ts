/**
 * Sift API: Cloudflare Worker entry point.
 *
 * Routes:
 *   GET /v1/product/{barcode}  ->  lookupProduct (KV cache, then Open Food Facts, then USDA)
 *
 * Setup (once):
 *   1. npx wrangler kv namespace create PRODUCT_CACHE      -> paste the id into wrangler.toml
 *   2. npx wrangler secret put USDA_API_KEY                -> key from https://api.data.gov/signup/
 *   3. set USER_AGENT in wrangler.toml to "Sift/<version> (<contact>)" as Open Food Facts asks
 * Run locally:  npx wrangler dev
 * Deploy:       npx wrangler deploy
 */

import { lookupProduct, type KvLike, type LookupDeps, type LookupResult } from "./product/lookup";
import { isValidBarcode, fetchOffProduct } from "../../openFoodFacts";
import { fetchUsdaByBarcode } from "../../usda";

export interface Env {
  /** Optional: without it every scan goes live to the sources. */
  PRODUCT_CACHE?: KvLike;
  USDA_API_KEY: string;
  USER_AGENT: string;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Wires the real readers into the lookup. The lookup itself imports neither reader. */
export function makeDeps(env: Env): LookupDeps {
  return {
    kv: env.PRODUCT_CACHE,
    isValidBarcode,
    fetchOff: (barcode) => fetchOffProduct(barcode, env.USER_AGENT),
    fetchUsda: (barcode) => fetchUsdaByBarcode(barcode, env.USDA_API_KEY),
  };
}

/** Maps a lookup result to an HTTP response. The app reads `next` to know when to ask for a label photo. */
export function toResponse(result: LookupResult): Response {
  switch (result.kind) {
    case "found":
      return json(200, {
        barcode: result.barcode,
        sources: result.sources,
        fromCache: result.fromCache,
        product: result.product,
        enriched: result.enriched,
      });
    case "invalid_barcode":
      return json(400, { error: "invalid_barcode" });
    case "not_found":
      return json(404, { error: "not_found", next: result.next });
    case "sources_unavailable":
      return json(503, { error: "sources_unavailable", next: result.next });
  }
}

export async function handle(request: Request, env: Env): Promise<Response> {
  if (!env.USDA_API_KEY || !env.USER_AGENT) {
    return json(500, { error: "server_misconfigured" });
  }
  if (request.method !== "GET") return json(405, { error: "method_not_allowed" });

  const match = /^\/v1\/product\/([^/]+)$/.exec(new URL(request.url).pathname);
  if (!match) return json(404, { error: "no_such_route" });

  let barcode: string;
  try {
    barcode = decodeURIComponent(match[1]!);
  } catch {
    return json(400, { error: "invalid_barcode" });
  }
  return toResponse(await lookupProduct(barcode, makeDeps(env)));
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
