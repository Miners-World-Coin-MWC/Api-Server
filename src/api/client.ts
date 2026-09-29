import { MWC_API_BASE } from "../config/network.js";
import type { ApiEnvelope } from "../types.js";

export class MwcApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "MwcApiError";
  }
}

export class MWCAPIClient {
  constructor(
    public readonly baseUrl: string = MWC_API_BASE,
    // Bound to globalThis: bare `fetch` requires `this === window`, and calling it as
    // `this.fetchImpl(...)` (an object method) breaks that and throws "Illegal invocation".
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis)
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers || {})
      }
    });

    const text = await response.text();
    let body: ApiEnvelope<T> | T;

    try {
      body = JSON.parse(text);
    } catch {
      throw new MwcApiError("MWC API returned invalid JSON", response.status, text);
    }

    if (!response.ok) {
      throw new MwcApiError(
        `MWC API HTTP ${response.status}`,
        response.status,
        body
      );
    }

    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      (body as ApiEnvelope<T>).error
    ) {
      const detail = (body as ApiEnvelope<T>).error;
      const detailText = typeof detail === "string" ? detail : JSON.stringify(detail);
      throw new MwcApiError(`MWC API returned an error: ${detailText}`, response.status, body);
    }

    if (
      body &&
      typeof body === "object" &&
      "result" in body
    ) {
      return (body as ApiEnvelope<T>).result;
    }

    return body as T;
  }

  info() {
    return this.request<import("../types.js").MwcInfo>("/info");
  }

  price() {
    return this.request<unknown>("/price");
  }

  height(height: number) {
    return this.request<unknown>(`/height/${encodeURIComponent(height)}`);
  }

  block(hash: string) {
    return this.request<unknown>(`/block/${encodeURIComponent(hash)}`);
  }

  header(hash: string) {
    return this.request<unknown>(`/header/${encodeURIComponent(hash)}`);
  }

  range(height: number, offset = 3) {
    return this.request<unknown>(
      `/range/${encodeURIComponent(height)}?offset=${encodeURIComponent(offset)}`
    );
  }

  balance(address: string) {
    return this.request<{ balance: number; received: number }>(
      `/balance/${encodeURIComponent(address)}`
    );
  }

  mempoolAddress(address: string) {
    return this.request<{ tx: string[]; txcount: number }>(
      `/mempool/${encodeURIComponent(address)}`
    );
  }

  unspent(address: string, amount?: number) {
    const suffix = amount === undefined ? "" : `?amount=${encodeURIComponent(amount)}`;
    return this.request<import("../types.js").MwcUtxo[]>(
      `/unspent/${encodeURIComponent(address)}${suffix}`
    );
  }

  history(address: string, offset?: number) {
    const suffix = offset === undefined ? "" : `?offset=${encodeURIComponent(offset)}`;
    return this.request<{ tx: string[]; txcount: number }>(
      `/history/${encodeURIComponent(address)}${suffix}`
    );
  }

  transaction(hash: string) {
    return this.request<unknown>(`/transaction/${encodeURIComponent(hash)}`);
  }

  mempool() {
    return this.request<unknown>("/mempool");
  }

  peers() {
    return this.request<unknown[]>("/peers");
  }

  supply() {
    return this.request<unknown>("/supply");
  }

  fee() {
    return this.request<unknown>("/fee");
  }

  decode(raw: string) {
    return this.request<unknown>(`/decode/${encodeURIComponent(raw)}`);
  }

  async broadcast(raw: string) {
    // The exact field name this API expects for /broadcast isn't documented anywhere I can
    // verify, and guessing wrong twice already produced this exact failure mode: the server
    // reads a different key than the one we send, gets `null`, and forwards that straight to
    // a Bitcoin-Core-style RPC call ("Expected type string, got null"). Rather than guess a
    // third time, try the plausible field names in order and use whichever one the API
    // actually accepts. A real rejection (double-spend, bad fee, etc.) looks different from
    // this specific "wrong key" signature, so we only move to the next candidate when the
    // error matches that signature - any other error is a genuine rejection and is thrown
    // immediately rather than retried.
    const candidates = ["raw", "rawtx", "hex", "tx"];
    const attempts: string[] = [];
    let lastError: unknown;
    for (const field of candidates) {
      try {
        return await this.request<string>("/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: raw })
        });
      } catch (e) {
        lastError = e;
        attempts.push(field);
        const detail = e instanceof MwcApiError ? JSON.stringify(e.details) : String(e);
        const looksLikeWrongFieldName = /got null|missing|required|undefined/i.test(detail);
        if (!looksLikeWrongFieldName) throw e;
      }
    }
    throw new MwcApiError(
      `MWC API rejected /broadcast under every field name tried (${attempts.join(", ")}). ` +
        `The real error from the last attempt is attached below - please check it and tell me the correct field name if you can find it.`,
      undefined,
      lastError
    );
  }
}
