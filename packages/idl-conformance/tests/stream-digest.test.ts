import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Vector } from "../src/adapter.js";
import { streamDigest } from "../src/stream-digest.js";

// Every digest vector on disk is graded. A vector added to the directory
// and forgotten here would be counted by the coverage rule and judged by
// nothing, which is the failure this file exists to prevent.
const directory = join(import.meta.dirname, "..", "assets", "vectors", "dsg.run.event_1", "digest");
const vectors = readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as Vector);

describe("stream seal agreement with the published Python producer", () => {
  it("grades every vector the coverage rule counts", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(5);
  });

  for (const vector of vectors) {
    it(`reproduces ${vector.name} and refuses a conflicting event`, () => {
      const bytes = Buffer.from(vector.bytes, "base64");
      expect(streamDigest(bytes)).toEqual({ ok: true, digest: vector.sha256 });
      // A second line claiming an existing sequence with a different body is
      // the one case a digest may not paper over: the stream is ambiguous.
      const first = bytes.toString("utf8").split("\n")[0] ?? "";
      const conflicting = `${bytes.toString("utf8")}\n${first.replace(/"kind":"[^"]*"/, '"kind":"tampered"')}`;
      expect(streamDigest(Buffer.from(conflicting))).not.toEqual({
        ok: true,
        digest: vector.sha256,
      });
    });
  }
});
