import type { ApiEnvelope } from "../types";

export function requestId(): string {
  return crypto.randomUUID();
}

export function ok<T>(data: T, request_id: string): Response {
  const body: ApiEnvelope<T> = { success: true, data, error: null, request_id };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export function fail(code: string, message: string, request_id: string, status = 400): Response {
  const body: ApiEnvelope<null> = {
    success: false,
    data: null,
    error: { code, message },
    request_id
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
