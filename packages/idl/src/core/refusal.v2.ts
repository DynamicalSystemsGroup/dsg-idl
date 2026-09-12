// dsg.core.refusal/2
// Owner: shared. Adds the two codes the shared authentication contract
// requires: a validator that cannot answer fails closed and says so, and a
// human confirmation outside its window is its own refusal, not a generic
// expiry. /1 is frozen; this ships beside it.
//
// `stage` and `correlationId` are optional additions (2026-09-11): the
// system has not shipped, so this profile amends in place rather than
// spawning a /3 for two backward-compatible optional fields. An existing
// non-proxy refusal carries neither. A proxy hop (dsg-run-console) always
// sends both: `stage: "proxy"` names which hop answered, `correlationId`
// is the proxy's own request id, replacing the `X-DSG-Refusal-Stage` /
// `X-Request-ID` header detour with in-body fields the same schema covers.
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
  // The proxy is the only producer today; a second stage is added here,
  // never invented as a parallel compatibility scheme, when a second one
  // exists.
  stage: Type.Optional(Type.Literal("proxy")),
  correlationId: Type.Optional(NonEmptyString),
});
export const RefusalV2Schema: typeof RefusalV2SchemaValue = RefusalV2SchemaValue;
export type RefusalV2 = Static<typeof RefusalV2Schema>;

export const refusalV2: ProfileEntry = {
  literal: REFUSAL_V2_PROFILE,
  rootShape: "refusal",
  shapes: { refusal: RefusalV2Schema },
};
