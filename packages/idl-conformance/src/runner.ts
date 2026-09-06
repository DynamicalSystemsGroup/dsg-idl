import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Vector } from "./adapter.js";

export type VectorVerdict = {
  readonly id: string;
  readonly expected: "accept" | "reject";
  readonly outcome: "pass" | "fail";
  readonly detail: string;
};

export type RunReport = {
  readonly passed: number;
  readonly failed: number;
  readonly verdicts: readonly VectorVerdict[];
};

type Checklist = { readonly profiles: Readonly<Record<string, number>> };

/** Runs every vector under `assetsDir` through the adapter. The checklist
 * is the coverage floor: a profile listed there with fewer vectors on disk
 * than promised fails the run, so a silently deleted directory cannot pass. */
export function runVectors(adapter: Adapter, assetsDir: string, checklist: Checklist): RunReport {
  const verdicts: VectorVerdict[] = [];

  for (const [profile, expectedCount] of Object.entries(checklist.profiles)) {
    const dir = join(assetsDir, profile.replaceAll("/", "_"));
    let files: string[] = [];
    for (const verdict of ["accept", "reject"] as const) {
      let names: string[] = [];
      try {
        names = readdirSync(join(dir, verdict)).filter((f) => f.endsWith(".json"));
      } catch {
        names = [];
      }
      files = files.concat(names.map((n) => join(dir, verdict, n)));
    }

    if (files.length < expectedCount) {
      verdicts.push({
        id: profile,
        expected: "accept",
        outcome: "fail",
        detail: `checklist promises ${expectedCount} vectors, found ${files.length}`,
      });
      continue;
    }

    for (const file of files) {
      const vector = JSON.parse(readFileSync(file, "utf8")) as Vector;
      const parse = adapter[`${vector.profile}#${vector.shape}`];
      if (parse === undefined) {
        verdicts.push({
          id: `${vector.profile}#${vector.shape}/${vector.name}`,
          expected: vector.verdict,
          outcome: "fail",
          detail: "adapter has no parser for this shape",
        });
        continue;
      }
      const result = parse(Buffer.from(vector.bytes, "base64"));
      const agreed = result.ok === (vector.verdict === "accept");
      verdicts.push({
        id: `${vector.profile}#${vector.shape}/${vector.name}`,
        expected: vector.verdict,
        outcome: agreed ? "pass" : "fail",
        detail: agreed
          ? (vector.rule ?? "")
          : result.ok
            ? `accepted but must reject: ${vector.rule ?? "unnamed rule"}`
            : `rejected but must accept: ${result.reason}`,
      });
    }
  }

  const failed = verdicts.filter((v) => v.outcome === "fail").length;
  return { passed: verdicts.length - failed, failed, verdicts };
}
