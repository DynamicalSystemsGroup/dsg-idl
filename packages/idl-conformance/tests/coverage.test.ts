// Rule 5: a profile with no vectors does not ship. Every registered
// profile must appear in the checklist and carry at least one accept and
// one reject vector on disk; the checklist count must match the files, so
// neither a silently deleted directory nor a stale count survives.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILES } from "@dynamicalsystems/idl";
import checklist from "../checklist.json" with { type: "json" };

const assets = join(import.meta.dirname, "..", "assets", "vectors");

function count(profile: string, verdict: string): number {
  try {
    return readdirSync(join(assets, profile.replaceAll("/", "_"), verdict)).filter((f) =>
      f.endsWith(".json"),
    ).length;
  } catch {
    return 0;
  }
}

describe("vector coverage", () => {
  it("lists every registered profile in the checklist", () => {
    for (const literal of Object.keys(PROFILES)) {
      expect(checklist.profiles, `${literal} has no checklist entry`).toHaveProperty([literal]);
    }
  });

  it("gives every profile at least one accept and one reject vector", () => {
    for (const literal of Object.keys(PROFILES)) {
      expect(count(literal, "accept"), `${literal} accepts`).toBeGreaterThanOrEqual(1);
      expect(count(literal, "reject"), `${literal} rejects`).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps every checklist count equal to the files on disk", () => {
    for (const [literal, expected] of Object.entries(checklist.profiles)) {
      const actual = count(literal, "accept") + count(literal, "reject") + count(literal, "digest");
      expect(actual, `${literal} checklist drift`).toBe(expected);
    }
  });
});
