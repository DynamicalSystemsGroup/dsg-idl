import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Vector } from "../src/adapter.js";
import { streamDigest } from "../src/stream-digest.js";

const vectors = ["float-utf8-stream", "gapped-stream"].map(
  (name) =>
    JSON.parse(
      readFileSync(
        new URL(
          `../assets/vectors/dsg.run.event_1/digest/streamSeal-${name}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Vector,
);

describe("stream seal agreement with the published Python producer", () => {
  for (const vector of vectors) {
    it(`reproduces ${vector.name} and detects a changed payload`, () => {
      const bytes = Buffer.from(vector.bytes, "base64");
      expect(streamDigest(bytes)).toEqual({ ok: true, digest: vector.sha256 });
      const changed = Buffer.from(bytes.toString("utf8").replace("café", "cafe"));
      expect(streamDigest(changed)).not.toEqual({ ok: true, digest: vector.sha256 });
    });
  }
});
