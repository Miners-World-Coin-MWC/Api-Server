import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wasm from "vite-plugin-wasm";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tiny-secp256k1 (a transitive dep of bitcoinjs-lib, used for signing in src/mwc.ts)
  // ships a WASM binary loaded via top-level await. vite-plugin-wasm handles the WASM
  // import itself. We deliberately do NOT use vite-plugin-top-level-await on top of it:
  // targeting esnext means native top-level await just works, and that plugin's SWC-based
  // bundle-info pass has known version-mismatch crashes ("missing field `type`") that add
  // fragility for no benefit here — this wallet only needs to run in current browsers.
  plugins: [wasm()],
  build: {
    target: "esnext"
  },
  esbuild: {
    target: "esnext"
  },
  resolve: {
    alias: {
      "@mwc/core": path.resolve(here, "../src/mwc.ts")
    }
  },
  server: {
    fs: {
      allow: [path.resolve(here, "..")]
    }
  }
});
