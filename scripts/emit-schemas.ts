// Renders every registered profile to JSON Schema under
// packages/idl/schema/, one file per profile, SHIPPED IN THE TARBALL so a
// non-TS consumer pins the package digest and never reads a sibling
// checkout. Committed output, checked fresh by `just check`. Profiles
// declaring a rootShape gain a root $ref so a whole-document validator has
// its entry point without knowing $defs internals.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILES } from "../packages/idl/src/index.js";

const out = join(import.meta.dirname, "..", "packages", "idl", "schema");
mkdirSync(out, { recursive: true });
for (const stale of readdirSync(out)) rmSync(join(out, stale));

for (const entry of Object.values(PROFILES)) {
  const file = `${entry.literal.replaceAll(".", "-").replaceAll("/", "-v")}.json`;
  const doc: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://github.com/DynamicalSystemsGroup/dsg-idl/schema/${file}`,
    title: entry.literal,
    $defs: entry.shapes,
  };
  if (entry.rootShape !== undefined) doc["$ref"] = `#/$defs/${entry.rootShape}`;
  writeFileSync(join(out, file), `${JSON.stringify(doc, null, 2)}\n`);
}
console.log(`emitted ${Object.keys(PROFILES).length} profile(s)`);
