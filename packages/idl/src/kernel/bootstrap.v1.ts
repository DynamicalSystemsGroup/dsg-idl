// dsg.kernel.bootstrap/1
// Owner: dsg-kernel (K14). The finite bootstrap intent: a signed,
// single-use, expiring authorization for exactly one of four record
// actions, binding plan and resource-spec digests. enroll_human_root
// (M030) is the additive action that anchors ordinary-authority
// enrollment; initialization is never reinterpreted as enrollment. The
// record-held bootstrap event payloads stay in the kernel.
//
// Lifted verbatim from dsg-kernel packages/core/src/contracts.ts at
// 00b33ac1. createdAt/expiresAt are frozen /1 nonempty strings, recorded
// in FROZEN_EXEMPTIONS; exact-second patterns would be a /2 against
// already-recorded signed intents.
import { type Static, Type } from "@sinclair/typebox";
import { closed, Hex64, NonEmptyString, Orn, type ProfileEntry } from "../primitives.js";

export const BOOTSTRAP_PROFILE = "dsg.kernel.bootstrap/1" as const;

const BootstrapActionSchemaValue = Type.Union([
  Type.Literal("initialize_kernel_record"),
  Type.Literal("restore_kernel_record"),
  Type.Literal("cutover_single_writer"),
  Type.Literal("enroll_human_root"),
]);
export const BootstrapActionSchema: typeof BootstrapActionSchemaValue = BootstrapActionSchemaValue;
export type BootstrapAction = Static<typeof BootstrapActionSchema>;

const BootstrapIntentSchemaValue = closed({
  version: Type.Literal(BOOTSTRAP_PROFILE),
  operation: NonEmptyString,
  action: BootstrapActionSchema,
  lineage: NonEmptyString,
  humanRoot: NonEmptyString,
  signer: Orn,
  scope: NonEmptyString,
  resources: Type.Array(
    closed({
      identity: NonEmptyString,
      specSha256: Hex64,
    }),
    { minItems: 1, uniqueItems: true },
  ),
  planSha256: Hex64,
  preconditionsSha256: Hex64,
  createdAt: NonEmptyString,
  expiresAt: NonEmptyString,
  maxUses: Type.Literal(1),
  cost: closed({
    currency: Type.Literal("USD"),
    maxMicroUsd: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    assumptionsSha256: Hex64,
  }),
  testOnly: Type.Boolean(),
});
export const BootstrapIntentSchema: typeof BootstrapIntentSchemaValue = BootstrapIntentSchemaValue;
export type BootstrapIntent = Static<typeof BootstrapIntentSchema>;

const SignedBootstrapIntentSchemaValue = closed({
  body: BootstrapIntentSchema,
  signature: Type.String({ pattern: "^[0-9a-f]{128}$" }),
});
export const SignedBootstrapIntentSchema: typeof SignedBootstrapIntentSchemaValue =
  SignedBootstrapIntentSchemaValue;
export type SignedBootstrapIntent = Static<typeof SignedBootstrapIntentSchema>;

export const bootstrapV1: ProfileEntry = {
  literal: BOOTSTRAP_PROFILE,
  shapes: { intent: BootstrapIntentSchema, signed: SignedBootstrapIntentSchema },
};
