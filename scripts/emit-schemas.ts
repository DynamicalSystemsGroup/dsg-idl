// Renders every registered profile to JSON Schema under schema/, one file
// per profile. Committed output, checked fresh by `just check`: Rego,
// Python, and jq read this directory and never hold their own copy.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILES } from "../packages/idl/src/index.js";

const out = join(import.meta.dirname, "..", "schema");
mkdirSync(out, { recursive: true });
for (const stale of readdirSync(out)) rmSync(join(out, stale));

for (const entry of Object.values(PROFILES)) {
  const file = `${entry.literal.replaceAll(".", "-").replaceAll("/", "-v")}.json`;
  const doc = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://github.com/DynamicalSystemsGroup/dsg-idl/schema/${file}`,
    title: entry.literal,
    $defs: entry.shapes,
  };
  writeFileSync(join(out, file), `${JSON.stringify(doc, null, 2)}\n`);
}
console.log(`emitted ${Object.keys(PROFILES).length} profile(s)`);
