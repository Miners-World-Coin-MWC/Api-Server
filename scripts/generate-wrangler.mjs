import fs from "node:fs";

const id = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (!id || !/^[a-f0-9-]{20,}$/i.test(id)) {
  throw new Error("CLOUDFLARE_D1_DATABASE_ID is required and must be a real Cloudflare D1 database id.");
}

const base = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8").replace(/\/\/.*$/gm, ""));
base.d1_databases[0].database_id = id;

fs.writeFileSync("wrangler.generated.jsonc", JSON.stringify(base, null, 2) + "\n");
console.log("Generated wrangler.generated.jsonc");
