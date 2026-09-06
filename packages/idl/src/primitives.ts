// The shared primitives every profile builds from. No profile defines its
// own: a digest is Hex64 everywhere, a timestamp is UtcSecond everywhere,
// an open object exists nowhere.
import { type TObject, type TProperties, type TSchema, Type } from "@sinclair/typebox";

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

/** One wire profile: the literal, and every top-level shape that crosses
 * the seam it names. Shape names are stable identifiers ("request",
 * "lease", "refusal"); vectors address a shape as "<literal>#<shape>". */
export type ProfileEntry = {
  readonly literal: `dsg.${string}.${string}/${number}`;
  readonly shapes: Readonly<Record<string, TSchema>>;
};
