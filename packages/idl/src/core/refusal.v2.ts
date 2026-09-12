// dsg.core.refusal/2
// Owner: shared. Adds the two codes the shared authentication contract
// requires: a validator that cannot answer fails closed and says so, and a
// human confirmation outside its window is its own refusal, not a generic
// expiry. /1 is frozen; this ships beside it.
// Frozen since v0.9.0. The stage and correlation fields a proxy hop needs
// ship in /3 beside it, because an emitted schema that differs from its
// released bytes is the one thing this profile may not do.
import { type Static, Type } from "@sinclair/typebox";
import { closed, NonEmptyString, type ProfileEntry } from "../primitives.js";

export const REFUSAL_V2_PROFILE = "dsg.core.refusal/2" as const;

const RefusalCodeV2SchemaValue = Type.Union([
  Type.Literal("assertion_invalid"),
  Type.Literal("audience_mismatch"),
  Type.Literal("expired"),
  Type.Literal("issuer_unknown"),
  Type.Literal("transport_unverified"),
  Type.Literal("relay_untrusted"),
  Type.Literal("identity_unbound"),
  Type.Literal("binding_expired"),
  Type.Literal("principal_suspended"),
  Type.Literal("not_dsg_account"),
  Type.Literal("session_expired"),
  Type.Literal("unknown_workload_class"),
  Type.Literal("image_not_pinned"),
  Type.Literal("not_a_requester"),
  Type.Literal("document_invalid"),
  Type.Literal("self_decision"),
  Type.Literal("no_ceiling"),
  Type.Literal("validation_unavailable"),
  Type.Literal("confirmation_expired"),
]);
export const RefusalCodeV2Schema: typeof RefusalCodeV2SchemaValue = RefusalCodeV2SchemaValue;
export type RefusalCodeV2 = Static<typeof RefusalCodeV2Schema>;

const RefusalV2SchemaValue = closed({
  profile: Type.Literal(REFUSAL_V2_PROFILE),
  code: RefusalCodeV2Schema,
  sentence: NonEmptyString,
});
export const RefusalV2Schema: typeof RefusalV2SchemaValue = RefusalV2SchemaValue;
export type RefusalV2 = Static<typeof RefusalV2Schema>;

export const refusalV2: ProfileEntry = {
  literal: REFUSAL_V2_PROFILE,
  rootDocument: "refusal",
  documents: { refusal: RefusalV2Schema },
};
