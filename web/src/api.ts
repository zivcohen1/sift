/** Talks to the Sift API (the team's Cloudflare Worker in backend/). */
import type { ProductResponse } from "./types";

/**
 * During `npm run dev` the Vite dev server forwards /api to the live Worker (see vite.config.ts).
 * The built website calls the Worker directly, which needs the Worker to send CORS headers.
 */
export const API_BASE: string = import.meta.env.DEV
  ? "/api"
  : (import.meta.env.VITE_API_BASE ?? "https://sift-api.siftmu.workers.dev");

export type LookupResult =
  | { kind: "found"; data: ProductResponse }
  | { kind: "not_found" }
  | { kind: "invalid_barcode" }
  | { kind: "unavailable"; message: string };

export async function lookupBarcode(
  barcode: string,
  fetchFn: typeof fetch = fetch,
  base: string = API_BASE,
): Promise<LookupResult> {
  let res: Response;
  try {
    res = await fetchFn(`${base}/v1/product/${encodeURIComponent(barcode)}`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    // Also what a browser reports when the API does not allow this website (CORS).
    return { kind: "unavailable", message: "Could not reach Sift. Check your connection and try again." };
  }
  if (res.status === 404) return { kind: "not_found" };
  if (res.status === 400) return { kind: "invalid_barcode" };
  if (!res.ok) {
    return {
      kind: "unavailable",
      message: `Sift's product databases are busy (error ${res.status}). Try again in a minute.`,
    };
  }
  try {
    return { kind: "found", data: (await res.json()) as ProductResponse };
  } catch {
    return { kind: "unavailable", message: "Sift sent an answer it could not read. Try again." };
  }
}
