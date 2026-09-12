// dsg.registry.revocations/1
// Owner: dsg-infra-module-registry (the S03 trust producer). Signed,
// monotonically versioned revocation snapshots with retained trust
// history; timestamps are epoch seconds by frozen choice of /1 (recorded
// in FROZEN_EXEMPTIONS; exact-second strings would be a /2).
// Lifted verbatim from dsg-infra-module-registry src/revocation.ts at
// 1f8c994.
import { Type, type Static } from "@sinclair/typebox";
import type { ProfileEntry } from "../primitives.js";

export const REVOCATIONS_PROFILE = "dsg.registry.revocations/1" as const;

const closed = { additionalProperties: false };
const text = Type.String({ minLength: 1 });
const digest = Type.String({ pattern: "^[0-9a-f]{64}$" });
const time = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

const RevocationSchemaValue = Type.Object(
  {
    domain: Type.Literal(REVOCATIONS_PROFILE),
    version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    issuedAt: time,
    expiresAt: time,
    previousSha256: Type.Union([digest, Type.Null()]),
    testOnly: Type.Literal(true),
    signerKey: digest,
    revoked: Type.Array(
      Type.Object(
        {
          kind: Type.Union([
            Type.Literal("principal"),
            Type.Literal("standing-order"),
            Type.Literal("law"),
            Type.Literal("class"),
            Type.Literal("key"),
          ]),
          id: text,
          effectiveAt: time,
          reason: text,
        },
        closed,
      ),
    ),
    trustHistory: Type.Array(
      Type.Object(
        {
          principal: text,
          publicKey: digest,
          role: Type.Union([
            Type.Literal("human"),
            Type.Literal("release"),
            Type.Literal("collector"),
          ]),
          action: Type.Union([
            Type.Literal("enroll"),
            Type.Literal("rotate"),
            Type.Literal("compromise"),
          ]),
          effectiveAt: time,
          authoritySha256: digest,
          replacesKey: Type.Union([digest, Type.Null()]),
        },
        closed,
      ),
    ),
  },
  closed,
);
export const RevocationSchema: typeof RevocationSchemaValue = RevocationSchemaValue;
export type RevocationSnapshot = Static<typeof RevocationSchema>;

const RevocationPointerSchemaValue = Type.Object(
  {
    version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    sha256: digest,
    url: Type.String({ pattern: "^/revocations/v/[1-9][0-9]*/snapshot\\.json$" }),
  },
  closed,
);
export const RevocationPointerSchema: typeof RevocationPointerSchemaValue =
  RevocationPointerSchemaValue;
export type RevocationPointer = Static<typeof RevocationPointerSchema>;

export const revocationsV1: ProfileEntry = {
  literal: REVOCATIONS_PROFILE,
  documents: { snapshot: RevocationSchema, pointer: RevocationPointerSchema },
};
