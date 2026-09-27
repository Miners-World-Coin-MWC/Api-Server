import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tiny-secp256k1 (a transitive dep of bitcoinjs-lib, used for signing in src/mwc.ts)
  // ships a WASM binary loaded via top-level await. Vite/Rollup can't bundle that without
  // these two plugins.
  plugins: [wasm(), topLevelAwait()],
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
