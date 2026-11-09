# Sift core logic (backend enrichment)

Turns an ingredient statement into `ProductFacts`: a parsed ingredient list, category hits
with certainty (definite or possible), ambiguous ingredients, and the kosher/halal status
decision. Pure functions, no network, no user data.

## Run

```bash
cd backend
npm install
npm test           # 103 unit tests
npm run typecheck
```

## Layout

| Path | Responsibility |
|---|---|
| `src/refdata.ts` | Knowledge-base loader, text normalising, whole-word `termRegex` (cached) |
| `src/enrich/ingredients.ts` | Parser: nesting, percentages, Contains / May contain |
| `src/enrich/categories.ts` | `matchCategory`: exclusions, definite terms, E-numbers, possible terms |
| `src/enrich/ambiguous.ts` | Ambiguous terms ("natural flavors") and the qualifiers that settle them |
| `src/enrich/religious.ts` | Kosher/halal status decision, concerns, kosher mark parsing |
| `src/enrich/index.ts` | `buildProductFacts`: the single path every source goes through |
| `src/enrich/fromSource.ts` | `enrichProduct`: takes an Open Food Facts or USDA product and returns facts, nutrients per 100 g, and kosher/halal assessments |
| `src/product/lookup.ts` | `lookupProduct`: barcode check, KV cache, Open Food Facts, USDA fallback/fill, enrich. Readers and KV are injected |
| `src/ai/assess.ts` | Ambiguous-ingredient guardrails: zod request schema, label text wrapped as data, one valid answer per item (anything else becomes `unclear`) |
| `src/ai/rules.ts` | AI rule-draft guardrails: per-rule validation, unknown `categoryId` dropped, clinician review forced if MedlinePlus is down, drafts unapproved |
| `src/index.ts` | Barrel export |
| `contracts/enriched_sample.json` | Worker JSON the Swift tests decode (kept in sync by `test/contract.test.ts`) |
| `ios/SiftCore/` | Swift package: JSON models and `RuleEngine.decide` (runs on the phone, so the profile never leaves it) |
| `data/*.json` | Versioned reference data (a change here goes through a pull request) |

## Design rules this code enforces

- A "May contain" hit is never more than *possible*.
- Whole-word matching: "graham" never matches "ham".
- Exclusion phrases are removed first: "cocoa butter" is not dairy.
- Kosher without recognised certification is `not_certified`, never assumed.
- Nothing is ever reported as "safe", only `no_listed_conflicts`.
- Output is deterministic, so a stored scan can be audited against `kbVersion`.

## Example

```ts
import { buildProductFacts } from "./src/enrich";

buildProductFacts("cocoa butter, sugar, whey, natural flavors");
// categoryHits: [{ categoryId: "dairy", ingredient: "whey", certainty: "definite", ... }]
// ambiguous:    [{ name: "natural flavor", mightBelongTo: ["dairy", ...] }]
```

## Using it with the source readers

`enrichProduct` accepts anything shaped like the Open Food Facts `FoodProduct` or the USDA
`UsdaProduct` (it does not import either file), so it works with both unchanged:

```ts
const off = await fetchOffProduct(barcode, userAgent);
const enriched = off && enrichProduct(off, "open_food_facts");
// enriched.facts, enriched.nutrientsPer100g, enriched.religious.kosher / .halal, enriched.warnings
```


## Product lookup (Section 4.1)

The two source readers are passed in, so `lookup.ts` imports neither file:

```ts
const result = await lookupProduct(barcode, {
  kv: env.SIFT_KV,
  isValidBarcode,
  fetchOff: (b) => fetchOffProduct(b, USER_AGENT),
  fetchUsda: (b) => fetchUsdaByBarcode(b, env.USDA_API_KEY),
});
// found | not_found | sources_unavailable | invalid_barcode
```

Cache rules: raw record kept 7 days (`src:v1:`), misses 1 day (`miss:v1:`), outages never
cached, a miss is cached only if every source answered, and a broken KV never breaks a scan.

## Swift side (not compiled in the environment that wrote it)

```bash
cd ios/SiftCore && swift test      # needs a Mac with Xcode
```

The contract test reads `contracts/enriched_sample.json` by walking five folders up from the
test file, so keep `contracts/` at the repository root next to `ios/`. If the Worker's output
shape changes on purpose: `UPDATE_CONTRACT=1 npx vitest run` in `backend/`, then `swift test`.

## Knowledge-base data

`data/*.json` here is a small sample. Do not overwrite the real knowledge base with it.


## Worker routes

| Route | Purpose |
|---|---|
| `GET /health` | `{ ok, kbVersion }` |
| `GET /v1/reference` | `kbVersion`, `categories` (`id`, `label`), `kosherAgencies`, `halalCertifiers` |
| `GET /v1/product/{barcode}` | Lookup and enrichment (see above) |
| `POST /v1/ingredients/analyze` | Body `{ ingredientText, packageText? }` → `{ source: "label_photo", enriched }`, same shape as a barcode scan |

The routes are open: no app key. The website calls them straight from the browser, where a
shared key could not be kept secret.
Analyze bodies are capped at 16 KB (`413`), and validation errors list field names only, never
the submitted text. Agencies in `/v1/reference` come from the same tables the certification
reader uses (`listKnownAgencies` in `src/enrich/fromSource.ts`).

Local runs: create `backend/.dev.vars` (git-ignored) with

```
USDA_API_KEY=...
```

then `npx wrangler dev` and, for example,

```bash
curl localhost:8787/health
curl localhost:8787/v1/reference
curl -X POST -H "content-type: application/json" \
  -d '{"ingredientText":"sugar, whey, natural flavors"}' localhost:8787/v1/ingredients/analyze
```
