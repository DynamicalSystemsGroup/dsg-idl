// The descriptor module is a translation of dsg-infra's
// policy/resource-descriptor.schema.json (committed here as a provenance
// fixture). This test holds the translation to the source: same required
// set, same property keys, and every const/pattern/bound the source states
// appears identically. If dsg-infra revs the source, this fails before any
// consumer drifts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ResourceDescriptorSchema } from "../src/infra/resource-descriptor.v1.js";

type JsonSchema = {
  required?: string[];
  properties?: Record<string, JsonSchema>;
  const?: unknown;
  pattern?: string;
  minimum?: number;
  minLength?: number;
  enum?: unknown[];
  type?: string | string[];
  additionalProperties?: boolean;
};

const source = JSON.parse(
  readFileSync(
    new URL("./fixtures/dsg-infra-resource-descriptor.schema.json", import.meta.url),
    "utf8",
  ),
) as JsonSchema;

// SAFETY: the module under test is a plain TypeBox object schema; this view
// reads only its JSON Schema representation.
const emitted = ResourceDescriptorSchema as unknown as Required<
  Pick<JsonSchema, "properties" | "required">
> &
  JsonSchema;

function normalized(schema: JsonSchema): Record<string, unknown> {
  // A source `type: ["string", "null"]` and an emitted anyOf union carry
  // the same wire meaning; both normalize to the marker "nullable-string".
  if (Array.isArray(schema.type) && schema.type.includes("null")) return { nullable: schema.type };
  const anyOf = (schema as { anyOf?: { type?: string }[] }).anyOf;
  if (anyOf !== undefined && anyOf.some((arm) => arm.type === "null")) {
    return { nullable: ["string", "null"] };
  }
  const kept: Record<string, unknown> = {};
  for (const key of ["const", "pattern", "minimum", "minLength", "enum"] as const) {
    if (schema[key] !== undefined) kept[key] = schema[key];
  }
  return kept;
}

describe("resource-descriptor source fidelity", () => {
  it("keeps the source's required set exactly", () => {
    expect([...(emitted.required ?? [])].sort()).toEqual([...(source.required ?? [])].sort());
  });

  it("keeps the source's property keys exactly, both closed", () => {
    expect(Object.keys(emitted.properties).sort()).toEqual(
      Object.keys(source.properties ?? {}).sort(),
    );
    expect(emitted.additionalProperties).toBe(false);
    expect(source.additionalProperties).toBe(false);
  });

  it("keeps every source const, pattern, bound and enum", () => {
    for (const [key, sourceProperty] of Object.entries(source.properties ?? {})) {
      const emittedProperty = emitted.properties[key];
      expect(emittedProperty, `missing property ${key}`).toBeDefined();
      const want = normalized(sourceProperty);
      const got = normalized(emittedProperty as JsonSchema);
      // enum vs union-of-literals: normalize emitted anyOf consts to enum
      if (want["enum"] !== undefined && got["enum"] === undefined) {
        const arms = (emittedProperty as { anyOf?: { const?: unknown }[] }).anyOf ?? [];
        got["enum"] = arms.map((arm) => arm.const);
      }
      expect(got, `property ${key} drifted from the source`).toEqual(want);
    }
  });

  it("keeps the nested reservation contract", () => {
    const sourceReservation = source.properties?.["reservation"] ?? {};
    const emittedReservation = emitted.properties["reservation"] as JsonSchema;
    expect([...(emittedReservation.required ?? [])].sort()).toEqual(
      [...(sourceReservation.required ?? [])].sort(),
    );
    expect(emittedReservation.additionalProperties).toBe(false);
  });
});
