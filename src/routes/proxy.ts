import type { Context } from "hono";
import type { AppEnv, Env } from "../types";
import { proxyOriginal } from "../lib/originalApi";

const allowed = new Set([
  "/info", "/price", "/mempool", "/peers", "/supply", "/fee"
]);

export async function proxy(c: Context<AppEnv>) {
  const path = new URL(c.req.url).pathname.replace(/^\/+/, "/");
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 1 && allowed.has(path)) {
    return proxyOriginal(c.env, c.req.raw, path);
  }

  if (parts.length === 2 && ["/height","/block","/header","/range","/balance","/mempool","/unspent","/history","/transaction","/decode"].includes(`/${parts[0]}`)) {
    return proxyOriginal(c.env, c.req.raw, path);
  }

  if (path === "/broadcast" && c.req.method === "POST") {
    return proxyOriginal(c.env, c.req.raw, path);
  }

  return new Response("Not Found", { status: 404 });
}
