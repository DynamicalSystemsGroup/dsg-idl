import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Adapter } from "../src/adapter.js";
import { runVectors } from "../src/runner.js";

const acceptAll: Adapter = {
  "dsg.test.example/1#request": () => ({ ok: true }),
};

function vectorDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "idl-vectors-"));
  const accept = join(dir, "dsg.test.example_1", "accept");
  mkdirSync(accept, { recursive: true });
  writeFileSync(
    join(accept, "minimal.json"),
    JSON.stringify({
      profile: "dsg.test.example/1",
      shape: "request",
      name: "minimal",
      verdict: "accept",
      bytes: Buffer.from("{}").toString("base64"),
    }),
  );
  return dir;
}

describe("runVectors", () => {
  it("passes when every vector agrees with the adapter", () => {
    const report = runVectors(acceptAll, vectorDir(), {
      profiles: { "dsg.test.example/1": 1 },
    });
    expect(report).toMatchObject({ passed: 1, failed: 0 });
  });

  it("fails a profile whose vectors on disk fall below the checklist count", () => {
    const report = runVectors(acceptAll, vectorDir(), {
      profiles: { "dsg.test.example/1": 5 },
    });
    expect(report.failed).toBe(1);
    expect(report.verdicts[0]?.detail).toContain("promises 5");
  });

  it("fails a shape the adapter cannot parse instead of skipping it", () => {
    const report = runVectors({}, vectorDir(), { profiles: { "dsg.test.example/1": 1 } });
    expect(report.failed).toBe(1);
    expect(report.verdicts[0]?.detail).toContain("no parser");
  });

  it("fails an accept vector the adapter rejects, naming the reason", () => {
    const rejectAll: Adapter = {
      "dsg.test.example/1#request": () => ({ ok: false, reason: "nope" }),
    };
    const report = runVectors(rejectAll, vectorDir(), {
      profiles: { "dsg.test.example/1": 1 },
    });
    expect(report.failed).toBe(1);
    expect(report.verdicts[0]?.detail).toContain("nope");
  });
});
