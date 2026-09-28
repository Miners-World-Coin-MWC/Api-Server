import { CLTV } from "../config/network.js";
import type { VanityProgress } from "../types.js";

export type VanityWorker = {
  cancel(): void;
  promise: Promise<{
    privateKeyHex: string;
    publicKeyHex: string;
    address: string;
    attempts: number;
  }>;
};

function randomPrivateKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

export function validateVanityPrefix(prefix: string): string {
  const normalized = prefix.trim();
  if (!normalized) throw new Error("Vanity prefix cannot be empty.");
  if (normalized.length > CLTV.maxVanityPrefixLength) {
    throw new Error(`Vanity prefix cannot exceed ${CLTV.maxVanityPrefixLength} characters.`);
  }
  if (!/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(normalized)) {
    throw new Error("Vanity prefix contains characters that are not valid Base58 characters.");
  }
  return normalized;
}

/**
 * Adapter-based vanity generator.
 *
 * The crypto adapter is deliberately injected because the exact MWC bitcoinjs-lib
 * build is loaded by the consuming wallet. This keeps the SDK compatible with the
 * existing MWC Explorer bitcoinjs-lib fork.
 */
export function createVanityGenerator(adapter: {
  privateKeyToAddress(privateKey: Uint8Array): {
    publicKeyHex: string;
    address: string;
  };
}, prefix: string, onProgress?: (progress: VanityProgress) => void): VanityWorker {
  const wanted = validateVanityPrefix(prefix);
  let cancelled = false;

  const promise = (async () => {
    let attempts = 0;
    const started = performance.now();

    while (!cancelled) {
      const privateKey = randomPrivateKey();
      attempts++;

      const result = adapter.privateKeyToAddress(privateKey);

      if (result.address.startsWith(wanted)) {
        return {
          privateKeyHex: [...privateKey].map((b) => b.toString(16).padStart(2, "0")).join(""),
          publicKeyHex: result.publicKeyHex,
          address: result.address,
          attempts
        };
      }

      if (attempts % 1000 === 0) {
        const elapsedMs = performance.now() - started;
        onProgress?.({
          attempts,
          elapsedMs,
          rate: elapsedMs > 0 ? attempts / (elapsedMs / 1000) : 0
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    throw new Error("Vanity generation cancelled.");
  })();

  return {
    cancel() {
      cancelled = true;
    },
    promise
  };
}
