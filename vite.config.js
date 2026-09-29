import {defineConfig} from "vite";
import wasm from "vite-plugin-wasm";
export default defineConfig({
  base: "./",
  // tiny-secp256k1 (used by bip32 for mnemonic/xprv derivation, and by the vanity-address
  // worker) ships a WASM binary loaded via top-level await. vite-plugin-wasm handles the
  // bundling; targeting esnext lets Rollup emit native top-level await. worker.format must be
  // "es" (module workers) for the same import()/top-level-await support to work inside the
  // vanity worker, and it needs the wasm plugin applied to its own build too.
  plugins: [wasm()],
  worker: {
    format: "es",
    plugins: () => [wasm()]
  },
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } }
});
