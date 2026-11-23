# Sift

Sift is a project for checking packaged foods against dietary restrictions.
Scan or enter a barcode to check ingredients, kosher/halal preferences, and save scans.

The API gets product data from Open Food Facts and USDA FoodData Central. The web app
checks it against your restrictions and stores your profile and history in your browser.

Verdicts include **Not a match**, **Check before eating**, **Not sure**, and **No listed
conflicts**. The knowledge base (version 0.2.0) covers 26 categories: 12 allergen, 4 medical, 6 diet and
4 religious. It is a starting dictionary that still needs review by a domain expert, so coverage
is not complete.

## Repository layout

| Path | Purpose |
|---|---|
| `web/` | React, TypeScript, and Vite app, including barcode scanning and the verdict engine |
| `backend/` | Cloudflare Worker API, product lookup, enrichment, and tests |
| `backend/data/` | Sample ingredient categories, ambiguous terms, and religious rules |
| `ios/SiftCore/` | Swift API models, on-device verdict engine, and contract tests |
| `contracts/enriched_sample.json` | API response fixture checked by a backend test |
| `openFoodFacts.ts`, `usda.ts`, `sourceErrors.ts` | Product source readers and shared error handling |
| `CORE-LOGIC.md` | Backend logic and design notes |
| Root PDF and DOCX files | Design document, UI concept, and literature review |

There is no root npm package. Run commands from `web/` or `backend/` as shown below.

## Prerequisites

- Node.js 24 with npm.
- A Cloudflare account to configure or deploy the Workers.
- A USDA API key to run the backend product routes.

## Run the web app

From the repository root:

```sh
cd web
npm ci
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`. Camera scanning works on
localhost; a hosted site needs HTTPS. You can also enter barcodes manually.

The app uses `https://sift-api.siftmu.workers.dev` by default. For a local backend, change
the proxy target in `web/vite.config.ts`. For production, set `VITE_API_BASE` at build time
to use a different API.

See [the web README](web/README.md) for the screen descriptions and hosting details.

## Configure and run the backend

From the repository root:

```sh
cd backend
npm ci
npx wrangler login
npx wrangler kv namespace create PRODUCT_CACHE
```

In `backend/wrangler.toml`, replace the placeholder KV namespace ID with the returned ID
and the placeholder contact email with the team's email.

Create `backend/.dev.vars` with your local values:

```dotenv
USDA_API_KEY=your_usda_api_key
```

This file is git-ignored. Obtain a USDA key from [api.data.gov](https://api.data.gov/signup/).
The API routes are open and do not require an app key.

Start the Worker from `backend/`:

```sh
npx wrangler dev
```

Check the health route (adjust the port if Wrangler uses a different one):

```sh
curl http://localhost:8787/health
```

| Route | Purpose |
|---|---|
| `GET /health` | Health status and knowledge-base version |
| `GET /v1/reference` | Categories and recognized certifiers |
| `GET /v1/product/{barcode}` | Product lookup and enriched ingredient facts |
| `POST /v1/ingredients/analyze` | Analyze JSON containing `ingredientText` and optional `packageText` |

The analysis route accepts text; it does not read a photograph itself.

## Validate changes

Run backend checks from `backend/`:

```sh
npm test
npm run typecheck
```

Run web checks from `web/`:

```sh
npm test
npm run build
```

The web build checks TypeScript and creates `web/dist/`. Use `npm run preview` to preview it.

If you intentionally change the API response format, update the contract fixture from
`backend/` and review the diff:

```sh
UPDATE_CONTRACT=1 npx vitest run test/contract.test.ts
```

Run Swift model, verdict, and contract tests on a Mac with Xcode and Swift 6 or newer
(Command Line Tools alone may lack XCTest):

```sh
cd ios/SiftCore
swift test
```

These tests decode the same backend fixture. The package provides core logic, not a full iOS app.

## Deploy

After configuring the namespace and contact email, set the deployed backend secrets and
deploy from `backend/`:

```sh
npx wrangler secret put USDA_API_KEY
npx wrangler deploy
```

Deploy the web app from `web/` after installing its dependencies and authenticating with
Cloudflare:

```sh
npm run deploy
```

This builds and deploys the website.

## Open work

- Replace the placeholder KV namespace ID and contact email in `backend/wrangler.toml`.
- Have a domain expert (for example a dietitian or a rabbi or imam for the religious rules)
  review `backend/data/`. Every change must bump `KB_VERSION` in `backend/src/refdata.ts`
  and regenerate the contract fixture.
- Connect a label-photo reading flow and the ambiguous-ingredient AI check to the web UI.
- Add profile export/import if profiles should transfer between browsers or devices.
