export {
  closed,
  Hex64,
  NonEmptyString,
  Orn,
  PersonReference,
  Reference,
  SafeInt,
  UtcSecond,
} from "./primitives.js";
export type { ProfileEntry } from "./primitives.js";
export {
  DISPATCH_CONSUME_PROFILE,
  DISPATCH_MAX_SKEW_SECONDS,
  DispatchConsumeRequestSchema,
  DispatchLeaseSchema,
  DispatchRefusalCodeSchema,
  DispatchRefusalSchema,
} from "./kernel/dispatch-consume.v1.js";
export type {
  DispatchConsumeRequest,
  DispatchLease,
  DispatchRefusal,
  DispatchRefusalCode,
} from "./kernel/dispatch-consume.v1.js";
export {
  AcceptedSchema,
  ExecutionDocumentSchema,
  ExecutionLawSchema,
  ExecutionResourcesSchema,
  OPERATION_PROFILE,
  OperationBeforeSchema,
  OperationCleanupSchema,
  OperationCostSchema,
  OperationEvidenceSchema,
  OperationExecutionSchema,
  OperationRequestSchema,
  OperationStatusSchema,
  ReadbackSchema,
} from "./run/operation.v1.js";
export type {
  Accepted,
  ExecutionDocument,
  ExecutionLaw,
  ExecutionResources,
  OperationBefore,
  OperationCleanup,
  OperationCost,
  OperationEvidence,
  OperationExecution,
  OperationRequest,
  OperationStatus,
  Readback,
} from "./run/operation.v1.js";
export {
  PRICE_PROFILE_REFERENCE,
  SCOPE_REFERENCE,
  SIGNED_LAW_DOMAIN,
  SIGNED_LAW_PROFILE,
  SignedLawBundleSchema,
} from "./infra/signed-law.v1.js";
export {
  RESOURCE_DESCRIPTOR_KIND,
  RESOURCE_DESCRIPTOR_PROFILE,
  ResourceDescriptorSchema,
} from "./infra/resource-descriptor.v1.js";
export type { ResourceDescriptor } from "./infra/resource-descriptor.v1.js";
export { ADOPTION_FACT_PROFILE, AdoptionFactSchema } from "./infra/adoption-fact.v1.js";
export type { AdoptionFact } from "./infra/adoption-fact.v1.js";
export type { SignedLawBundle } from "./infra/signed-law.v1.js";
export {
  REVOCATIONS_PROFILE,
  RevocationPointerSchema,
  RevocationSchema,
} from "./registry/revocations.v1.js";
export type { RevocationPointer, RevocationSnapshot } from "./registry/revocations.v1.js";
export {
  BOOTSTRAP_PROFILE,
  BootstrapActionSchema,
  BootstrapIntentSchema,
  SignedBootstrapIntentSchema,
} from "./kernel/bootstrap.v1.js";
export type {
  BootstrapAction,
  BootstrapIntent,
  SignedBootstrapIntent,
} from "./kernel/bootstrap.v1.js";
export {
  STANDING_ORDER_ACTIVATION_PROFILE,
  StandingOrderActivationEventSchema,
  StandingOrderActivationSchema,
  StandingOrderModeSchema,
  SignedStandingOrderActivationSchema,
} from "./kernel/standing-order-activation.v1.js";
export type {
  StandingOrderActivation,
  StandingOrderActivationEvent,
  StandingOrderMode,
  SignedStandingOrderActivation,
} from "./kernel/standing-order-activation.v1.js";
export {
  ORDINARY_AUTHORITY_PROFILE,
  OrdinaryAuthoritySchema,
} from "./kernel/ordinary-authority.v1.js";
export type { OrdinaryAuthority } from "./kernel/ordinary-authority.v1.js";
export { EXECUTOR_PROTOCOL_VERSION, PROVIDER_PROTOCOL_VERSION } from "./run/contract-versions.js";
export type { ExecutorProtocolVersion, ProviderProtocolVersion } from "./run/contract-versions.js";
export {
  EVENT_PROFILE,
  EVENT_LINE_PREFIX,
  LIFECYCLE_KINDS,
  EventSchema,
  EventStreamSealSchema,
} from "./run/event.v1.js";
export type { Event, EventStreamSeal } from "./run/event.v1.js";
export {
  REQUEST_PROFILE,
  ExperimentRefSchema,
  RequestCeilingsSchema,
  RunRequestSchema,
} from "./run/request.v1.js";
export type { ExperimentRef, RequestCeilings, RunRequest } from "./run/request.v1.js";
export { DECISION_PROFILE, RunDecisionSchema } from "./run/decision.v1.js";
export type { RunDecision } from "./run/decision.v1.js";
export {
  RUN_SUMMARY_PROFILE,
  RunSummaryDecisionSchema,
  RunSummarySchema,
} from "./run/run-summary.v1.js";
export type { RunSummary, RunSummaryDecision } from "./run/run-summary.v1.js";
export { REFUSAL_PROFILE, RefusalCodeSchema, RefusalSchema } from "./core/refusal.v1.js";
export type { Refusal, RefusalCode } from "./core/refusal.v1.js";
export {
  GOOGLE_SIGN_IN_ISSUER,
  IDENTITY_BINDING_PROFILE,
  IdentityBindingSchema,
} from "./core/identity-binding.v1.js";
export type { IdentityBinding } from "./core/identity-binding.v1.js";

import type { ProfileEntry } from "./primitives.js";
import { dispatchConsumeV1 } from "./kernel/dispatch-consume.v1.js";
import { operationV1 } from "./run/operation.v1.js";
import { eventV1 } from "./run/event.v1.js";
import { requestV1 } from "./run/request.v1.js";
import { decisionV1 } from "./run/decision.v1.js";
import { runSummaryV1 } from "./run/run-summary.v1.js";
import { refusalV1 } from "./core/refusal.v1.js";
import { identityBindingV1 } from "./core/identity-binding.v1.js";
import { signedLawV1 } from "./infra/signed-law.v1.js";
import { resourceDescriptorV1 } from "./infra/resource-descriptor.v1.js";
import { adoptionFactV1 } from "./infra/adoption-fact.v1.js";
import { revocationsV1 } from "./registry/revocations.v1.js";
import { bootstrapV1 } from "./kernel/bootstrap.v1.js";
import { ordinaryAuthorityV1 } from "./kernel/ordinary-authority.v1.js";
import { standingOrderActivationV1 } from "./kernel/standing-order-activation.v1.js";

/** Every profile this version of the package defines, keyed by literal.
 * Profile modules are added here as they are extracted; the rules test
 * and the schema emitter walk this registry, so a module that is not
 * registered does not exist. */
export const PROFILES: Readonly<Record<string, ProfileEntry>> = {
  [dispatchConsumeV1.literal]: dispatchConsumeV1,
  [operationV1.literal]: operationV1,
  [eventV1.literal]: eventV1,
  [requestV1.literal]: requestV1,
  [decisionV1.literal]: decisionV1,
  [runSummaryV1.literal]: runSummaryV1,
  [refusalV1.literal]: refusalV1,
  [identityBindingV1.literal]: identityBindingV1,
  [signedLawV1.literal]: signedLawV1,
  [resourceDescriptorV1.literal]: resourceDescriptorV1,
  [adoptionFactV1.literal]: adoptionFactV1,
  [revocationsV1.literal]: revocationsV1,
  [bootstrapV1.literal]: bootstrapV1,
  [ordinaryAuthorityV1.literal]: ordinaryAuthorityV1,
  [standingOrderActivationV1.literal]: standingOrderActivationV1,
};
