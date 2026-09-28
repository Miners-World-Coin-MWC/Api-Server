import {defineConfig} from "vite";
import wasm from "vite-plugin-wasm";
export default defineConfig({
  base: "./",
  // tiny-secp256k1 (used by bip32 for mnemonic/xprv derivation) ships a WASM binary loaded
  // via top-level await. vite-plugin-wasm handles the bundling; targeting esnext lets Rollup
  // emit native top-level await instead of needing a second, less reliable helper plugin.
  plugins: [wasm()],
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } }
});
