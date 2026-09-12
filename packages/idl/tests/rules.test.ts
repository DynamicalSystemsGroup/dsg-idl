// The package's own law. These tests mechanize spec rules 1-3 over every
// registered profile: closed objects everywhere, the literal present on at
// least one shape, digests as Hex64, timestamps as UtcSecond. A profile
// that violates them does not ship.
import { describe, expect, it } from "vitest";
import type { TSchema } from "@sinclair/typebox";
import { PROFILES } from "../src/index.js";

/** What these rules read out of a compiled TypeBox schema. Every field is
 * the JSON Schema keyword of the same name. The schemas are walked through
 * this view rather than through assertions: a serialized round trip parses
 * the keywords once, at the boundary, and the walk below stays typed. */
type SchemaView = {
  type?: string;
  properties?: Record<string, SchemaView>;
  patternProperties?: Record<string, SchemaView>;
  items?: SchemaView;
  anyOf?: SchemaView[];
  additionalProperties?: unknown;
  pattern?: string;
  const?: unknown;
};
function viewOf(schema: TSchema): SchemaView {
  // SAFETY: a compiled TypeBox schema serializes to JSON Schema, so every
  // field this view reads is a keyword of that output or absent. Nothing
  // here dereferences a field without checking it first.
  return JSON.parse(JSON.stringify(schema)) as SchemaView;
}

const HEX64 = "^[0-9a-f]{64}$";

// Named debts: fields a frozen /1 keeps looser than the current rule.
// Every entry is a /N+1 candidate; nothing may be added here for a NEW
// profile version.
const FROZEN_EXEMPTIONS = new Set([
  // dsg.run.operation/1 predates the exact-second ruling and the plane
  // emits fractional seconds today; tightening is a /2.
  "dsg.run.operation/1#accepted.acceptedAt",
  // dsg.registry.revocations/1 chose epoch-second integers before the
  // exact-second-string ruling; string timestamps would be a /2.
  "dsg.registry.revocations/1#snapshot.issuedAt",
  "dsg.registry.revocations/1#snapshot.expiresAt",
  "dsg.registry.revocations/1#snapshot.revoked[].effectiveAt",
  "dsg.registry.revocations/1#snapshot.trustHistory[].effectiveAt",
  // dsg-infra's descriptor source schema chose sha256:-prefixed digests;
  // bare Hex64 would be a /2 of that document.
  "dsg.infra.resource-descriptor/1#descriptor.imageDigest",
  "dsg.infra.resource-descriptor/1#descriptor.moduleDigest",
  // K14 recorded signed intents with free-form instants; exact-second
  // strings would be a /2 against already-retained canonical bytes.
  "dsg.kernel.bootstrap/1#intent.createdAt",
  "dsg.kernel.bootstrap/1#intent.expiresAt",
  "dsg.kernel.bootstrap/1#signed.body.createdAt",
  "dsg.kernel.bootstrap/1#signed.body.expiresAt",
]);
const UTC_SECOND = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$";

type Node = { schema: SchemaView; path: string };

function walk(schema: SchemaView, path: string): Node[] {
  const nodes: Node[] = [{ schema, path }];
  if (schema.properties !== undefined) {
    for (const [key, child] of Object.entries(schema.properties)) {
      nodes.push(...walk(child, `${path}.${key}`));
    }
  }
  if (schema.patternProperties !== undefined) {
    for (const child of Object.values(schema.patternProperties)) {
      nodes.push(...walk(child, `${path}.*`));
    }
  }
  if (schema.items !== undefined) nodes.push(...walk(schema.items, `${path}[]`));
  if (schema.anyOf !== undefined) {
    for (const [i, child] of schema.anyOf.entries()) {
      nodes.push(...walk(child, `${path}|${i}`));
    }
  }
  return nodes;
}

/** A TypeBox Record over unconstrained string keys emits patternProperties
 * whose pattern matches every key, so every property is value-constrained:
 * closed in effect without additionalProperties. */
function isClosedRecord(schema: SchemaView): boolean {
  const patterns = Object.keys(schema.patternProperties ?? {});
  return patterns.length > 0 && patterns.every((p) => p === "^(.*)$" || p === "^.*$");
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
      for (const [documentName, document] of Object.entries(entry.documents)) {
        for (const node of walk(viewOf(document), `${entry.literal}#${documentName}`)) {
          if (node.schema.type === "object" && !isClosedRecord(node.schema)) {
            expect(node.schema.additionalProperties, `${node.path} is open`).toBe(false);
          }
        }
      }
    }
  });

  it("puts the profile literal on at least one document, or names its carrier", () => {
    for (const [, entry] of entries) {
      const carried = Object.values(entry.documents).some((document) =>
        Object.values(viewOf(document).properties ?? {}).some(
          (property) => property.const === entry.literal,
        ),
      );
      if (!carried) {
        expect(
          entry.literalNote,
          `${entry.literal} carries its literal in no document and names no carrier`,
        ).toBeTruthy();
      }
    }
  });

  it("types every digest field as Hex64 and every timestamp as UtcSecond", () => {
    for (const [, entry] of entries) {
      for (const [documentName, document] of Object.entries(entry.documents)) {
        for (const node of walk(viewOf(document), `${entry.literal}#${documentName}`)) {
          const leaf = node.path.split(".").at(-1) ?? "";
          // A union wrapper carries no pattern itself; its non-null arms must.
          const patterns =
            node.schema.anyOf === undefined
              ? [node.schema.pattern]
              : node.schema.anyOf.filter((arm) => arm.type !== "null").map((arm) => arm.pattern);
          if (FROZEN_EXEMPTIONS.has(node.path)) continue;
          if (/(sha256|Sha256|Digest)$/.test(leaf)) {
            for (const pattern of patterns) {
              expect(pattern, `${node.path} is a digest without Hex64`).toBe(HEX64);
            }
          }
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
