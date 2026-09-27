import type { Env, OriginalEnvelope } from "../types";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"
]);

function upstreamUrl(env: Env, path: string, search = "") {
  const base = env.ORIGINAL_API_URL.replace(/\/+$/, "");
  return `${base}${path}${search}`;
}

function cleanHeaders(source: Headers, includeContentType = true): Headers {
  const h = new Headers();
  source.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && (includeContentType || key.toLowerCase() !== "content-type")) {
      h.set(key, value);
    }
  });
  return h;
}

export async function proxyOriginal(env: Env, request: Request, path: string): Promise<Response> {
  const url = new URL(request.url);
  const target = upstreamUrl(env, path, url.search);
  const headers = cleanHeaders(request.headers);
  const init: RequestInit = { method: request.method, headers, redirect: "follow" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  const upstream = await fetch(target, init);
  const outHeaders = cleanHeaders(upstream.headers);
  outHeaders.set("x-mwc-api-proxy", "minersworld-api-wallet");
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export async function getOriginalJson<T>(env: Env, path: string, search = ""): Promise<T> {
  const response = await fetch(upstreamUrl(env, path, search), {
    headers: { accept: "application/json", "cache-control": "no-cache" }
  });
  if (!response.ok) throw new Error(`Original API returned HTTP ${response.status} for ${path}`);
  const body = (await response.json()) as OriginalEnvelope<T>;
  if (body.error !== null && body.error !== undefined) {
    throw new Error(typeof body.error === "string" ? body.error : JSON.stringify(body.error));
  }
  if (body.result === undefined) throw new Error(`Original API response missing result for ${path}`);
  return body.result;
}
