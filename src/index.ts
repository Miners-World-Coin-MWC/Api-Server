import { Hono } from "hono";
import type { AppEnv, Env } from "./types";
import { requestId } from "./lib/response";
import {
  nodechain, paramschain, minimum, ledgerincome, healthsync,
  balance, history, locks, owed, registerLock, heartbeat, ledgerEntry, treasury
} from "./routes/newApi";
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

app.get("/api/nodechain", nodechain);
app.get("/api/paramschain", paramschain);
app.get("/api/minimum", minimum);
app.get("/api/ledgerincome", ledgerincome);
app.get("/api/healthsync", healthsync);
app.get("/api/balance/:address", balance);
app.get("/api/history/:address", history);
app.get("/api/locks/:pubkey", locks);
app.get("/api/owed/:pubkey", owed);

app.post("/api/admin/locks/register", registerLock);
app.post("/api/admin/workers/heartbeat", heartbeat);
app.post("/api/admin/ledger/entry", ledgerEntry);
app.post("/api/admin/treasury", treasury);

app.all("*", proxy);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      env.DB.prepare(`INSERT INTO health_events(id,component,status,details_json,created_at) VALUES(?,?,?,?,?)`)
        .bind(crypto.randomUUID(), "cron", "ok", JSON.stringify({ ran_at: Math.floor(Date.now()/1000) }), Math.floor(Date.now()/1000))
        .run()
        .catch(() => undefined)
    );
  }
};
