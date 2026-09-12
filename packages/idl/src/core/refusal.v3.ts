// Normalized organization refusal. HTTP adapters preserve code as their
// reason field; their transport envelopes are documented separately.
// Dependency outages are not verdicts about a person.
import { type Static, Type } from "@sinclair/typebox";
import { closed, NonEmptyString, type ProfileEntry } from "../primitives.js";

export const REFUSAL_V3_PROFILE = "dsg.core.refusal/3" as const;

const RefusalCodeV3SchemaValue = Type.Union([
  Type.Literal("organization_absent"),
  Type.Literal("organization_exists"),
  Type.Literal("domain_mismatch"),
  Type.Literal("suspended"),
  Type.Literal("organization_disabled"),
  Type.Literal("claims_missing"),
  Type.Literal("not_qualified"),
  Type.Literal("subject_conflict"),
]);
export const RefusalCodeV3Schema: typeof RefusalCodeV3SchemaValue = RefusalCodeV3SchemaValue;
export type RefusalCodeV3 = Static<typeof RefusalCodeV3Schema>;

const RefusalStageV3SchemaValue = Type.Union([
  Type.Literal("proxy"),
  Type.Literal("provider"),
  Type.Literal("identity_read"),
  Type.Literal("plane"),
  Type.Literal("console"),
  Type.Literal("kernel"),
  Type.Literal("record"),
  Type.Literal("claim"),
]);
export const RefusalStageV3Schema: typeof RefusalStageV3SchemaValue = RefusalStageV3SchemaValue;
export type RefusalStageV3 = Static<typeof RefusalStageV3Schema>;

const RefusalV3SchemaValue = closed({
  profile: Type.Literal(REFUSAL_V3_PROFILE),
  code: RefusalCodeV3Schema,
  sentence: NonEmptyString,
  stage: Type.Optional(RefusalStageV3Schema),
  correlationId: Type.Optional(NonEmptyString),
  detail: Type.Optional(NonEmptyString),
});
export const RefusalV3Schema: typeof RefusalV3SchemaValue = RefusalV3SchemaValue;
export type RefusalV3 = Static<typeof RefusalV3Schema>;

export const refusalV3: ProfileEntry = {
  literal: REFUSAL_V3_PROFILE,
  rootDocument: "refusal",
  documents: { refusal: RefusalV3Schema },
};
