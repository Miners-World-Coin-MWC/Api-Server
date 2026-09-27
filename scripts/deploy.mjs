import { execFileSync } from "node:child_process";
execFileSync("npm", ["run", "generate-wrangler"], { stdio: "inherit" });
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "minersworld_api", "--remote", "--config", "wrangler.generated.jsonc"], { stdio: "inherit" });
execFileSync("npx", ["wrangler", "deploy", "--config", "wrangler.generated.jsonc"], { stdio: "inherit" });
