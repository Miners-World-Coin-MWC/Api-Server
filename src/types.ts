export interface Env {
  DB: D1Database;
  ORIGINAL_API_URL: string;
  CHAIN: string;
  CORS_ORIGIN: string;
  MWC_DECIMALS: string;
  MWC_MIN_LOCK_SECONDS: string;
  ADMIN_API_KEY?: string;
  BROADCAST_API_KEY?: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  request_id: string;
}

export interface OriginalEnvelope<T> {
  error: unknown;
  id?: string;
  result?: T;
}

export interface MwcUtxo {
  txid: string;
  vout: number;
  value: number;
  scriptPubKey?: { asm?: string; hex?: string; type?: string; address?: string };
  confirmations?: number;
}

export type AppEnv = { Bindings: Env; Variables: { requestId: string } };
