// Runs every committed vector through the reference adapter. Exit 0 only
// when every vector agrees with the schemas. CI for this repo; consumers
// run the same runner with their own adapter instead.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { referenceAdapter } from "./reference-adapter.js";
import { runVectors } from "./runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const checklist = JSON.parse(readFileSync(join(root, "checklist.json"), "utf8"));
const report = runVectors(referenceAdapter(), join(root, "assets", "vectors"), checklist);

for (const verdict of report.verdicts) {
  if (verdict.outcome === "fail") console.error(`FAIL ${verdict.id}: ${verdict.detail}`);
}
console.log(JSON.stringify({ passed: report.passed, failed: report.failed }));
process.exit(report.failed === 0 ? 0 : 1);
