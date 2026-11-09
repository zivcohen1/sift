# Sift web app

The Sift website: scan a barcode with the phone's camera (or type it), get a verdict based on
your restrictions. It follows the screens in `Sift UX UI Concept.pdf`.

- **Scan** — live camera barcode scanning (EAN-13, EAN-8, UPC-A, UPC-E) with ZXing, plus a
  box to type the number.
- **Verdict** — Not a match / Check before eating / Not sure / No listed conflicts, the reasons,
  and every ingredient tagged.
- **My restrictions** — categories to avoid, kosher/halal with the certifiers you accept, and
  what to do when Sift isn't sure.
- **History** — saved scans.

The product data comes from the team's API (`backend/`, deployed at
`https://sift-api.siftmu.workers.dev`). The verdict is decided **in the browser**, and the
profile and history are saved **only in this browser** (localStorage). Nothing about the user
is sent to a server.

## Run it on Windows

Needs [Node.js 20 or newer](https://nodejs.org). In PowerShell:

```powershell
cd web
npm install
npm run dev        # opens on http://localhost:5173
npm test           # 22 unit tests
```

`npm run dev` forwards `/api` to the live API, so it works on your laptop right away.
The camera works on `localhost` with a laptop webcam. A **phone** only allows the camera on an
`https://` site, so test phone scanning on the deployed link (below).

## Put it online (Cloudflare, same place as the API)

**Option A, automatic on every push.** In the Cloudflare dashboard, go to Workers & Pages,
create an application by importing the GitHub repo `zivcohen1/sift`, and set:

| Setting | Value |
|---|---|
| Root directory / path | `web` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

The root-directory setting may be under advanced settings. Cloudflare then gives the site an
address like `https://sift-web.<your-subdomain>.workers.dev`.

**Option B, from your laptop.**

```powershell
cd web
npx wrangler login     # once
npm run deploy         # builds, then uploads dist/
```

### The API must allow the website (CORS)

The deployed website calls the API from a different address, so the API has to send
`access-control-allow-origin`. That is the small change in `backend/src/worker.ts` (with a test
in `backend/test/worker.test.ts`). After it is merged, redeploy the API:

```powershell
cd backend
npx wrangler deploy
```

Until then the deployed site shows "Could not reach Sift", while `npm run dev` still works.

## Code map

| File | What it does |
|---|---|
| `src/api.ts` | Calls `GET /v1/product/{barcode}` |
| `src/ruleEngine.ts` | The verdict algorithm from the design document (§4.2), in TypeScript |
| `src/profile.ts`, `src/history.ts`, `src/storage.ts` | Saving on this device only |
| `src/reference.ts` | Categories (read from `backend/data/categories.json`) and certifiers |
| `src/barcode.ts` | Check digit (reuses `isValidBarcode` from `openFoodFacts.ts`), UPC-E expansion |
| `src/components/BarcodeScanner.tsx` | Camera scanning (loads only when you tap Scan) |
| `src/screens/*` | Scan, Verdict, My restrictions, History |
| `wrangler.jsonc` | Cloudflare hosting: serves the built `dist/` folder |

Add a category to `backend/data/categories.json` and it appears in "My restrictions" on the
next build.

## Not done yet

- Photographing the label when a barcode isn't found (needs a label-reading route in the API).
- The AI check for unclear ingredients like "natural flavor" (they show as "Not sure" for now).
- Export / import of the profile, so it survives clearing the browser or switching phones.
