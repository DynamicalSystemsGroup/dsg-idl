// dsg.run.decision/1
// Owner: dsg-kernel (the decisions route verifies the signature against
// the decider's recorded public key). A decision is a signature, not a
// session. The requester may not decide their own run.
import { type Static, Type } from "@sinclair/typebox";
import { closed, Hex64, NonEmptyString, Orn, UtcSecond, type ProfileEntry } from "../primitives.js";

export const DECISION_PROFILE = "dsg.run.decision/1" as const;

const RunDecisionSchemaValue = closed({
  profile: Type.Literal(DECISION_PROFILE),
  runId: NonEmptyString,
  requestDigest: Hex64,
  decision: Type.Union([Type.Literal("approved"), Type.Literal("refused")]),
  cause: Type.Union([NonEmptyString, Type.Null()]),
  decidedAt: UtcSecond,
  decider: Orn,
  signature: NonEmptyString,
});
export const RunDecisionSchema: typeof RunDecisionSchemaValue = RunDecisionSchemaValue;
export type RunDecision = Static<typeof RunDecisionSchema>;

export const decisionV1: ProfileEntry = {
  literal: DECISION_PROFILE,
  rootShape: "decision",
  shapes: { decision: RunDecisionSchema },
};
