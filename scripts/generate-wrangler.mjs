import fs from "node:fs";

const id = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (!id || !/^[a-f0-9-]{20,}$/i.test(id)) {
  throw new Error("CLOUDFLARE_D1_DATABASE_ID is required and must be a real Cloudflare D1 database id.");
}

// Strip // line comments from JSONC without corrupting "//" that appears inside string
// literals (e.g. "https://..."). A naive `.replace(/\/\/.*$/gm, "")` truncates any value
// containing a URL, which is exactly what this file has (ORIGINAL_API_URL).
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

const base = JSON.parse(stripJsonComments(fs.readFileSync("wrangler.jsonc", "utf8")));
base.d1_databases[0].database_id = id;

fs.writeFileSync("wrangler.generated.jsonc", JSON.stringify(base, null, 2) + "\n");
console.log("Generated wrangler.generated.jsonc");
