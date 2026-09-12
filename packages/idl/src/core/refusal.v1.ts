// dsg.core.refusal/1
// Owner: shared. Kernel, plane, and console read this one envelope.
// Identity ladder codes are identity-verifier-spec.md section 3.5.
// Login and request codes are person-loop-spec.md sections 4.1 and 4.2.
// The sentence is what a person hears; identifiers do not belong here.
import { type Static, Type } from "@sinclair/typebox";
import { closed, NonEmptyString, type ProfileEntry } from "../primitives.js";

export const REFUSAL_PROFILE = "dsg.core.refusal/1" as const;

const RefusalCodeSchemaValue = Type.Union([
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
]);
export const RefusalCodeSchema: typeof RefusalCodeSchemaValue = RefusalCodeSchemaValue;
export type RefusalCode = Static<typeof RefusalCodeSchema>;

const RefusalSchemaValue = closed({
  profile: Type.Literal(REFUSAL_PROFILE),
  code: RefusalCodeSchema,
  sentence: NonEmptyString,
});
export const RefusalSchema: typeof RefusalSchemaValue = RefusalSchemaValue;
export type Refusal = Static<typeof RefusalSchema>;

export const refusalV1: ProfileEntry = {
  literal: REFUSAL_PROFILE,
  rootDocument: "refusal",
  documents: { refusal: RefusalSchema },
};
