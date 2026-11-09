/**
 * Sift API: Cloudflare Worker entry point.
 *
 * Routes (Table 2 of the design document):
 *   GET  /health                   liveness and knowledge-base version (no app key needed)
 *   GET  /v1/reference             categories and recognised kosher/halal agencies
 *   GET  /v1/product/{barcode}     lookupProduct (KV cache, then Open Food Facts, then USDA)
 *   POST /v1/ingredients/analyze   ProductFacts for label text read on the phone
 *
 * Every /v1 route needs the `x-sift-app-key` header (Section 3.5). This stops casual abuse;
 * it is not strong authentication (production would add Apple App Attest).
 *
 * Setup (once):
 *   1. npx wrangler kv namespace create PRODUCT_CACHE      -> paste the id into wrangler.toml
 *   2. npx wrangler secret put USDA_API_KEY                -> key from https://api.data.gov/signup/
 *   3. npx wrangler secret put APP_KEY                     -> any long random string; the app sends it
 *   4. set USER_AGENT in wrangler.toml to "Sift/<version> (<contact>)" as Open Food Facts asks
 * Run locally:  put USDA_API_KEY and APP_KEY in backend/.dev.vars, then npx wrangler dev
 * Deploy:       npx wrangler deploy
 */

import { z } from "zod";
import { lookupProduct, type KvLike, type LookupDeps, type LookupResult } from "./product/lookup";
import { enrichProduct, listKnownAgencies } from "./enrich/fromSource";
import { loadKnowledgeBase } from "./refdata";
import { isValidBarcode, fetchOffProduct } from "../../openFoodFacts";
import { fetchUsdaByBarcode } from "../../usda";

export interface Env {
  /** Optional: without it every scan goes live to the sources. */
  PRODUCT_CACHE?: KvLike;
  USDA_API_KEY: string;
  USER_AGENT: string;
  /** Shared app key the iPhone app sends in `x-sift-app-key`. Worker secret. */
  APP_KEY: string;
}

export const APP_KEY_HEADER = "x-sift-app-key";
/** Label text is short; anything bigger is not an ingredient statement. */
export const MAX_BODY_BYTES = 16 * 1024;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
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

/** Compare without stopping at the first different character, so timing does not leak the key. */
export function sameKey(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
}

// ---- Route handlers --------------------------------------------------------------------

function health(): Response {
  return json(200, { ok: true, kbVersion: loadKnowledgeBase().version });
}

/** What the app needs to validate rule category IDs and build its certifier picker (Section 7.2). */
function reference(): Response {
  const kb = loadKnowledgeBase();
  const agencies = listKnownAgencies();
  return json(200, {
    kbVersion: kb.version,
    categories: kb.categories.map((c) => ({ id: c.id, label: c.label })),
    kosherAgencies: agencies.filter((a) => a.scheme === "kosher").map(({ id, name }) => ({ id, name })),
    halalCertifiers: agencies.filter((a) => a.scheme === "halal").map(({ id, name }) => ({ id, name })),
  });
}

export const AnalyzeRequestSchema = z.object({
  /** The ingredient statement read on the phone with Apple Vision. */
  ingredientText: z.string().trim().min(1).max(8000),
  /** Any other text printed on the package (for kosher marks such as "OU-D"). Optional. */
  packageText: z.string().max(4000).optional(),
});

/**
 * Same enrichment as a barcode scan, so a photographed label and a scanned product are
 * judged by identical logic (Section 4.1, step 4). Nothing is cached: the text came from
 * one user's photo.
 */
async function analyzeIngredients(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "body_too_large" });

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: "body_too_large" });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Field paths only, never the submitted text (Section 3.5: no logging or echoing of bodies).
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body"))];
    return json(400, { error: "invalid_request", fields });
  }

  const enriched = enrichProduct(
    { ingredientsText: parsed.data.ingredientText, labelsText: parsed.data.packageText, nutrition: null },
    "label_photo",
  );
  return json(200, { source: "label_photo", enriched });
}

// ---- Router ----------------------------------------------------------------------------

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response> | Response;
interface Route {
  method: "GET" | "POST";
  pattern: RegExp;
  needsAppKey: boolean;
  handler: Handler;
}

const ROUTES: Route[] = [
  { method: "GET", pattern: /^\/health$/, needsAppKey: false, handler: () => health() },
  { method: "GET", pattern: /^\/v1\/reference$/, needsAppKey: true, handler: () => reference() },
  {
    method: "GET",
    pattern: /^\/v1\/product\/([^/]+)$/,
    needsAppKey: true,
    handler: async (_req, env, [rawBarcode]) => {
      if (!env.USDA_API_KEY || !env.USER_AGENT) return json(500, { error: "server_misconfigured" });
      let barcode: string;
      try {
        barcode = decodeURIComponent(rawBarcode!);
      } catch {
        return json(400, { error: "invalid_barcode" });
      }
      return toResponse(await lookupProduct(barcode, makeDeps(env)));
    },
  },
  { method: "POST", pattern: /^\/v1\/ingredients\/analyze$/, needsAppKey: true, handler: (req) => analyzeIngredients(req) },
];

export async function handle(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const matching = ROUTES.filter((r) => r.pattern.test(path));
  if (matching.length === 0) return json(404, { error: "no_such_route" });

  const allowed = [...new Set(matching.map((r) => r.method))];
  if (request.method === "OPTIONS") {
    // CORS preflight (browser testing only; the iPhone app does not need it).
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": [...allowed, "OPTIONS"].join(", "),
        "access-control-allow-headers": `content-type, ${APP_KEY_HEADER}`,
        "access-control-max-age": "86400",
      },
    });
  }

  const route = matching.find((r) => r.method === request.method);
  if (!route) return json(405, { error: "method_not_allowed" }, { allow: allowed.join(", ") });

  if (route.needsAppKey) {
    if (!env.APP_KEY) return json(500, { error: "server_misconfigured" });
    if (!sameKey(request.headers.get(APP_KEY_HEADER), env.APP_KEY)) return json(401, { error: "unauthorized" });
  }

  const params = route.pattern.exec(path)!.slice(1);
  return route.handler(request, env, params);
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};
