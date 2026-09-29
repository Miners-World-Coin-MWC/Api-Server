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
      throw new MwcApiError(
        "MWC API returned invalid JSON",
        response.status,
        text
      );
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
      const detailText =
        typeof detail === "string"
          ? detail
          : JSON.stringify(detail);

      throw new MwcApiError(
        `MWC API returned an error: ${detailText}`,
        response.status,
        body
      );
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
    return this.request<unknown>(
      `/height/${encodeURIComponent(height)}`
    );
  }

  block(hash: string) {
    return this.request<unknown>(
      `/block/${encodeURIComponent(hash)}`
    );
  }

  header(hash: string) {
    return this.request<unknown>(
      `/header/${encodeURIComponent(hash)}`
    );
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
    const suffix =
      amount === undefined
        ? ""
        : `?amount=${encodeURIComponent(amount)}`;

    return this.request<import("../types.js").MwcUtxo[]>(
      `/unspent/${encodeURIComponent(address)}${suffix}`
    );
  }

  history(address: string, offset?: number) {
    const suffix =
      offset === undefined
        ? ""
        : `?offset=${encodeURIComponent(offset)}`;

    return this.request<{ tx: string[]; txcount: number }>(
      `/history/${encodeURIComponent(address)}${suffix}`
    );
  }

  transaction(hash: string) {
    return this.request<unknown>(
      `/transaction/${encodeURIComponent(hash)}`
    );
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
    return this.request<unknown>(
      `/decode/${encodeURIComponent(raw)}`
    );
  }

  async broadcast(raw: string) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new MwcApiError(
        "Cannot broadcast an empty raw transaction"
      );
    }

    /*
     * The official MWC API /broadcast endpoint expects the raw
     * transaction as a form parameter named "raw":
     *
     *     raw = <signed transaction hex>
     *
     * The Python API implementation is:
     *
     *     raw = request.values.get("raw")
     *     return Transaction().broadcast(raw)
     *
     * Therefore this must NOT be sent as plain text and must NOT
     * be wrapped in JSON.
     */
    const body = new URLSearchParams();
    body.set("raw", raw.trim());

    return this.request<string>("/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
  }
}
