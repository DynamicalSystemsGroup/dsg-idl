// dsg.core.refusal/3
// Owner: shared. Same codes as /2, plus the two fields a refusal needs when
// more than one hop can produce it: which hop answered, and the identifier
// that finds that hop's own log line. The console already sends both on
// every refusal it relays, so the contract describes what crosses the wire
// instead of trailing it. /2 is frozen and ships beside this.
//
// Both are optional because a single-hop refusal has no second stage to
// name and no proxy request to correlate; a relayed refusal carries both.
import { type Static, Type } from "@sinclair/typebox";
import { closed, NonEmptyString, type ProfileEntry } from "../primitives.js";
import { RefusalCodeV2Schema } from "./refusal.v2.js";

export const REFUSAL_V3_PROFILE = "dsg.core.refusal/3" as const;

export const RefusalCodeV3Schema: typeof RefusalCodeV2Schema = RefusalCodeV2Schema;
export type RefusalCodeV3 = Static<typeof RefusalCodeV3Schema>;

const RefusalStageV3SchemaValue = Type.Union([
  Type.Literal("proxy"),
  Type.Literal("provider"),
  Type.Literal("identity_read"),
  Type.Literal("plane"),
]);
export const RefusalStageV3Schema: typeof RefusalStageV3SchemaValue = RefusalStageV3SchemaValue;
export type RefusalStageV3 = Static<typeof RefusalStageV3Schema>;

const RefusalV3SchemaValue = closed({
  profile: Type.Literal(REFUSAL_V3_PROFILE),
  code: RefusalCodeV3Schema,
  sentence: NonEmptyString,
  stage: Type.Optional(RefusalStageV3Schema),
  correlationId: Type.Optional(NonEmptyString),
});
export const RefusalV3Schema: typeof RefusalV3SchemaValue = RefusalV3SchemaValue;
export type RefusalV3 = Static<typeof RefusalV3Schema>;

export const refusalV3: ProfileEntry = {
  literal: REFUSAL_V3_PROFILE,
  rootDocument: "refusal",
  documents: { refusal: RefusalV3Schema },
};
