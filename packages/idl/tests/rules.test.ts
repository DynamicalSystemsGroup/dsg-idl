// The package's own law. These tests mechanize spec rules 1-3 over every
// registered profile: closed objects everywhere, the literal present on at
// least one shape, digests as Hex64, timestamps as UtcSecond. A profile
// that violates them does not ship.
import { describe, expect, it } from "vitest";
import type { TSchema } from "@sinclair/typebox";
import { PROFILES } from "../src/index.js";

const HEX64 = "^[0-9a-f]{64}$";

// Named debts: fields a frozen /1 keeps looser than the current rule.
// Every entry is a /N+1 candidate; nothing may be added here for a NEW
// profile version.
const FROZEN_EXEMPTIONS = new Set([
  // dsg.run.operation/1 predates the exact-second ruling and the plane
  // emits fractional seconds today; tightening is a /2.
  "dsg.run.operation/1#accepted.acceptedAt",
]);
const UTC_SECOND = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$";

type Node = { schema: TSchema; path: string };

function walk(schema: TSchema, path: string): Node[] {
  const nodes: Node[] = [{ schema, path }];
  const anySchema = schema as unknown as {
    type?: string;
    properties?: Record<string, TSchema>;
    items?: TSchema;
    anyOf?: TSchema[];
  };
  if (anySchema.properties !== undefined) {
    for (const [key, child] of Object.entries(anySchema.properties)) {
      nodes.push(...walk(child, `${path}.${key}`));
    }
  }
  if (anySchema.items !== undefined) nodes.push(...walk(anySchema.items, `${path}[]`));
  if (anySchema.anyOf !== undefined) {
    for (const [i, child] of anySchema.anyOf.entries()) {
      nodes.push(...walk(child, `${path}|${i}`));
    }
  }
  return nodes;
}

const entries = Object.entries(PROFILES);

describe("profile registry law", () => {
  it("keys the registry by each entry's own literal", () => {
    for (const [key, entry] of entries) expect(entry.literal).toBe(key);
  });

  it("names every literal dsg.<domain>.<name>/<version>", () => {
    for (const [, entry] of entries) {
      expect(entry.literal).toMatch(/^dsg\.[a-z-]+\.[a-z-]+\/[1-9][0-9]*$/);
    }
  });

  it("closes every object at every level", () => {
    for (const [, entry] of entries) {
      for (const [shapeName, shape] of Object.entries(entry.shapes)) {
        for (const node of walk(shape, `${entry.literal}#${shapeName}`)) {
          const anySchema = node.schema as unknown as {
            type?: string;
            additionalProperties?: unknown;
          };
          if (anySchema.type === "object") {
            expect(anySchema.additionalProperties, `${node.path} is open`).toBe(false);
          }
        }
      }
    }
  });

  it("puts the profile literal on at least one shape", () => {
    for (const [, entry] of entries) {
      const carried = Object.values(entry.shapes).some((shape) => {
        const anySchema = shape as unknown as {
          properties?: Record<string, { const?: unknown }>;
        };
        return anySchema.properties?.["profile"]?.const === entry.literal;
      });
      expect(carried, `${entry.literal} has no shape carrying its literal`).toBe(true);
    }
  });

  it("types every digest field as Hex64 and every timestamp as UtcSecond", () => {
    for (const [, entry] of entries) {
      for (const [shapeName, shape] of Object.entries(entry.shapes)) {
        for (const node of walk(shape, `${entry.literal}#${shapeName}`)) {
          const anySchema = node.schema as unknown as {
            pattern?: string;
            anyOf?: { pattern?: string; type?: string }[];
          };
          const leaf = node.path.split(".").at(-1) ?? "";
          // A union wrapper carries no pattern itself; its non-null arms must.
          const patterns =
            anySchema.anyOf === undefined
              ? [anySchema.pattern]
              : anySchema.anyOf.filter((arm) => arm.type !== "null").map((arm) => arm.pattern);
          if (/(sha256|Sha256|Digest)$/.test(leaf)) {
            for (const pattern of patterns) {
              expect(pattern, `${node.path} is a digest without Hex64`).toBe(HEX64);
            }
          }
          if (FROZEN_EXEMPTIONS.has(node.path)) continue;
          if (/(At)$/.test(leaf) && leaf !== "At") {
            for (const pattern of patterns) {
              expect(pattern, `${node.path} is a timestamp without UtcSecond`).toBe(UTC_SECOND);
            }
          }
        }
      }
    }
  });
});
