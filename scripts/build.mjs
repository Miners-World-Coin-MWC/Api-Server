import { mkdir, cp, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

await mkdir(dist, { recursive: true });
await cp(join(root, "public"), dist, { recursive: true });

try {
  await access(join(root, "vendor", "bitcoinJS-lib.js"), constants.F_OK);
  await mkdir(join(dist, "vendor"), { recursive: true });
  await cp(
    join(root, "vendor", "bitcoinJS-lib.js"),
    join(dist, "vendor", "bitcoinJS-lib.js")
  );
  console.log("Copied vendor/bitcoinJS-lib.js");
} catch {
  console.log("bitcoinJS-lib.js not present locally; GitHub Actions will fetch it.");
}

console.log("Static GitHub Pages build completed.");
