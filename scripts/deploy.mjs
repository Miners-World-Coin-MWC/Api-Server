import { execFileSync } from "node:child_process";
execFileSync("npx", ["wrangler", "deploy", "--config", "wrangler.jsonc"], { stdio: "inherit" });
