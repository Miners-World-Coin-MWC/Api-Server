import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

const url = "https://raw.githubusercontent.com/Miners-World-Coin-MWC/explorer/refs/heads/main/js/bitcoinJS-lib.js";
const output = join(process.cwd(), "vendor", "bitcoinJS-lib.js");

try {
  await access(output, constants.F_OK);
  console.log(`Using existing ${output}`);
  process.exit(0);
} catch {}

await mkdir(join(process.cwd(), "vendor"), { recursive: true });

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Unable to download bitcoinJS-lib.js: HTTP ${response.status}`);
}

const data = await response.arrayBuffer();
await writeFile(output, Buffer.from(data));
console.log(`Downloaded ${output} (${data.byteLength} bytes)`);
