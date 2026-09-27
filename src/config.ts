import type { Env } from "./types";

export const CONFIG = {
  coin: "MWC",
  decimals: 8,
  addressPrefix: 20,
  scriptPrefix: 10,
  wifPrefix: 123,
  xpubPrefix: 0x0488b21e,
  xprvPrefix: 0x0488ade4,
  bech32: "mwc",
  blockTimeSeconds: 120,
  halvingInterval: 300000,
  maxSupplyAtomic: 300_000_000n * 100_000_000n,
  developerFeePercent: 10,
  defaultApi: "https://api.minersworld.org"
} as const;

export function envConfig(env: Env) {
  return {
    ...CONFIG,
    originalApi: env.ORIGINAL_API_URL || CONFIG.defaultApi,
    minLockSeconds: Number.parseInt(env.MWC_MIN_LOCK_SECONDS || "0", 10)
  };
}
