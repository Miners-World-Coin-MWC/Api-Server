import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
