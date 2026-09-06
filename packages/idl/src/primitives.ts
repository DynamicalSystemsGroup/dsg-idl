// The shared primitives every profile builds from. No profile defines its
// own: a digest is Hex64 everywhere, a timestamp is UtcSecond everywhere,
// an open object exists nowhere.
import { type TObject, type TProperties, type TSchema, Type } from "@sinclair/typebox";
import { ORN_PATTERN, SHA256_PATTERN } from "@dynamicalsystems/orn-schemas";

/** Closed object: an extra field is a different protocol. */
export const closed = <T extends TProperties>(properties: T): TObject<T> =>
  Type.Object(properties, { additionalProperties: false });

/** Lowercase sha256 hex. Every digest on the wire. */
export const Hex64 = Type.String({ pattern: "^[0-9a-f]{64}$" });

/** Exact UTC second, Z suffix, no fractional part. */
export const UtcSecond = Type.String({
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
});

export const NonEmptyString = Type.String({ minLength: 1 });

export const SafeInt = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

/** An ORN, validated by the grammar dsg-orn owns. Built from the exported
 * pattern, not the exported schema object: the upstream schemas carry
 * JSON Schema $id metadata, and embedding the same $id in several route
 * schemas makes validators refuse the duplicate. The pattern is the wire
 * truth; the metadata is not. */
export const Orn = Type.String({ pattern: ORN_PATTERN });

/** The pair of an ORN and the sha256 pinning a version (dsg-orn Reference). */
export const Reference = closed({
  orn: Orn,
  sha256: Type.String({ pattern: SHA256_PATTERN }),
});

/** One wire profile: the literal, and every top-level shape that crosses
 * the seam it names. Shape names are stable identifiers ("request",
 * "lease", "refusal"); vectors address a shape as "<literal>#<shape>". */
export type ProfileEntry = {
  readonly literal: `dsg.${string}.${string}/${number}`;
  readonly shapes: Readonly<Record<string, TSchema>>;
};
