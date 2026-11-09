import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** The team's Cloudflare Worker (backend/). */
const API = "https://sift-api.siftmu.workers.dev";

export default defineConfig({
  plugins: [react()],
  server: {
    // The app reuses files that live outside web/: backend/data/categories.json and openFoodFacts.ts.
    fs: { allow: [".."] },
    // During `npm run dev`, /api/... is forwarded to the live API by the dev server,
    // so local testing works even before the API sends CORS headers.
    proxy: {
      "/api": { target: API, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
