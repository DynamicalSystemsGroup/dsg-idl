// dsg.kernel.dispatch-consume/1
// Owner: dsg-kernel (the consume route produces the lease and the refusal;
// the plane produces the request).
//
// K05/I3: the dispatch-authorization consume contract between the kernel
// and the plane. Immediately before its first non-cleanup cloud mutation -
// identity, bucket and IAM preparation included, not only job submission -
// the plane consumes a short-lived, single-operation dispatch authorization
// bound to operation, generation, envelope digest, law digest and
// reservation. The committed consume event is the authorization ordering
// point; it is not atomic with any provider API. A replay returns the
// original lease and never renews it; a renewal is a new recorded
// authorization decision for the same operation and reservation.
//
// Lifted verbatim from dsg-kernel packages/core/src/dispatch.ts at commit
// c2d39d95 (wire shapes only; the record-held event payloads stay in the
// kernel). This file is frozen: changes ship as dispatch-consume.v2.ts.
import { type Static, Type } from "@sinclair/typebox";
import {
  closed,
  Hex64,
  NonEmptyString,
  Orn,
  Reference,
  UtcSecond,
  type ProfileEntry,
} from "../primitives.js";

export const DISPATCH_CONSUME_PROFILE = "dsg.kernel.dispatch-consume/1" as const;

/** The bounded clock skew a lease check must tolerate, in seconds. */
export const DISPATCH_MAX_SKEW_SECONDS = 300;

const DispatchConsumeRequestSchemaValue = closed({
  profile: Type.Literal(DISPATCH_CONSUME_PROFILE),
  /** The kernel operation identity from the accepted OperationRequest. */
  operationId: NonEmptyString,
  /** The workspace generation the plane admitted the operation at. */
  generation: Type.Integer({ minimum: 0 }),
  /** The Case the operation belongs to - the stream the consume event
   *  lands on and the stream the reservation was recorded on. */
  caseOrn: Orn,
  /** SHA256(JCS(complete OperationRequest)) - the M010 envelope digest. */
  envelopeSha256: Hex64,
  /** The exact retained signed-law bytes the Case pins. */
  lawSha256: Hex64,
  /** The K04 reservation the authorization is bound to: sha256 is the
   *  reservation event's record id. */
  reservation: Reference,
  requestedAt: UtcSecond,
  /** False: first consumption or idempotent replay of it. True: an explicit
   *  renewal - a new recorded authorization decision for the same operation
   *  and reservation after lease expiry with the work known unsubmitted. A
   *  replay never renews; only this flag does, and it re-runs every
   *  revocation check at the current record state. */
  renewal: Type.Boolean(),
});
export const DispatchConsumeRequestSchema: typeof DispatchConsumeRequestSchemaValue =
  DispatchConsumeRequestSchemaValue;
export type DispatchConsumeRequest = Static<typeof DispatchConsumeRequestSchema>;

const DispatchLeaseSchemaValue = closed({
  profile: Type.Literal(DISPATCH_CONSUME_PROFILE),
  /** The consume event's record id: the committed ordering point. */
  leaseId: Hex64,
  operationId: NonEmptyString,
  generation: Type.Integer({ minimum: 0 }),
  caseOrn: Orn,
  envelopeSha256: Hex64,
  lawSha256: Hex64,
  reservation: Reference,
  consumedAt: UtcSecond,
  /** Fixed maximum duration from consumedAt; the plane checks validity
   *  before each new non-cleanup call, Batch submission included. */
  expiresAt: UtcSecond,
  /** The bounded clock skew a lease check must tolerate, in seconds. */
  maxSkewSeconds: Type.Integer({ minimum: 0, maximum: DISPATCH_MAX_SKEW_SECONDS }),
  renewal: Type.Literal("new-authorization-required"),
  /** False when this response replays an earlier committed consumption:
   *  the lease bytes, expiry included, are the original's. */
  fresh: Type.Boolean(),
});
export const DispatchLeaseSchema: typeof DispatchLeaseSchemaValue = DispatchLeaseSchemaValue;
export type DispatchLease = Static<typeof DispatchLeaseSchema>;

const DispatchRefusalCodeSchemaValue = Type.Union([
  Type.Literal("unknown_operation"),
  Type.Literal("no_reservation"),
  Type.Literal("binding_mismatch"),
  Type.Literal("revoked"),
  Type.Literal("authority_refused"),
  Type.Literal("renewal_requires_existing_consumption"),
  Type.Literal("unavailable"),
]);
export const DispatchRefusalCodeSchema: typeof DispatchRefusalCodeSchemaValue =
  DispatchRefusalCodeSchemaValue;
export type DispatchRefusalCode = Static<typeof DispatchRefusalCodeSchema>;

const DispatchRefusalSchemaValue = closed({
  profile: Type.Literal(DISPATCH_CONSUME_PROFILE),
  code: DispatchRefusalCodeSchema,
  issues: Type.Array(NonEmptyString, { minItems: 1 }),
});
export const DispatchRefusalSchema: typeof DispatchRefusalSchemaValue = DispatchRefusalSchemaValue;
export type DispatchRefusal = Static<typeof DispatchRefusalSchema>;

export const dispatchConsumeV1: ProfileEntry = {
  literal: DISPATCH_CONSUME_PROFILE,
  documents: {
    request: DispatchConsumeRequestSchema,
    lease: DispatchLeaseSchema,
    refusal: DispatchRefusalSchema,
  },
};
