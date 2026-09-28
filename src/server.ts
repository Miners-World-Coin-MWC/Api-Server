import { serve } from "@hono/node-server";
import app from "./index";
import type { Env } from "./types";

// Plain Node server: runs anywhere Node runs (your machine, GitHub Codespaces, any VPS).
// No Cloudflare, no API keys, no database. Settings come from optional env vars.
const env: Env = {
  ORIGINAL_API_URL: process.env.ORIGINAL_API_URL ?? "https://api.minersworld.org",
  CHAIN: process.env.CHAIN ?? "mainnet",
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "*",
  MWC_DECIMALS: process.env.MWC_DECIMALS ?? "8",
  MWC_MIN_LOCK_SECONDS: process.env.MWC_MIN_LOCK_SECONDS ?? "0",
  INCOME_ADDRESS: process.env.INCOME_ADDRESS,
  ALLOCATION_ADDRESSES: process.env.ALLOCATION_ADDRESSES
};

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: (request) => app.fetch(request, env), port }, () => {
  console.log(`MWC API listening on http://localhost:${port} -> ${env.ORIGINAL_API_URL}`);
});
