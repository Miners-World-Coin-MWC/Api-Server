import { Hono } from "hono";
import type { AppEnv } from "./types";
import { requestId } from "./lib/response";
import { nodechain, paramschain, minimum, healthsync, balance, history, locks, owed } from "./routes/newApi";
import { proxy } from "./routes/proxy";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const id = requestId();
  c.set("requestId", id);
  await next();
  c.header("x-request-id", id);
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
  c.header("x-frame-options", "DENY");
  c.header("access-control-allow-origin", c.env.CORS_ORIGIN || "*");
  c.header("access-control-allow-headers", "content-type, authorization, x-mwc-broadcast-key");
  c.header("access-control-allow-methods", "GET,POST,OPTIONS");
});

app.options("*", c => new Response(null, { status: 204 }));

// Everything below is stateless: no database, no admin key, nothing running except this
// Worker. Lock lookups recompute addresses from (pubkey, unlock_time) on demand and check
// the original chain API live — there's nothing to register or store.
app.get("/api/nodechain", nodechain);
app.get("/api/paramschain", paramschain);
app.get("/api/minimum", minimum);
app.get("/api/healthsync", healthsync);
app.get("/api/balance/:address", balance);
app.get("/api/history/:address", history);
app.get("/api/locks/:pubkey", locks);
app.get("/api/owed/:pubkey", owed);

app.all("*", proxy);

export default {
  fetch: app.fetch
};
