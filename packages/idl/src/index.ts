export { closed, Hex64, NonEmptyString, Orn, Reference, SafeInt, UtcSecond } from "./primitives.js";
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
export type { SignedLawBundle } from "./infra/signed-law.v1.js";
export {
  REVOCATIONS_PROFILE,
  RevocationPointerSchema,
  RevocationSchema,
} from "./registry/revocations.v1.js";
export type { RevocationPointer, RevocationSnapshot } from "./registry/revocations.v1.js";

import type { ProfileEntry } from "./primitives.js";
import { dispatchConsumeV1 } from "./kernel/dispatch-consume.v1.js";
import { operationV1 } from "./run/operation.v1.js";
import { signedLawV1 } from "./infra/signed-law.v1.js";
import { resourceDescriptorV1 } from "./infra/resource-descriptor.v1.js";
import { revocationsV1 } from "./registry/revocations.v1.js";

/** Every profile this version of the package defines, keyed by literal.
 * Profile modules are added here as they are extracted; the rules test
 * and the schema emitter walk this registry, so a module that is not
 * registered does not exist. */
export const PROFILES: Readonly<Record<string, ProfileEntry>> = {
  [dispatchConsumeV1.literal]: dispatchConsumeV1,
  [operationV1.literal]: operationV1,
  [signedLawV1.literal]: signedLawV1,
  [resourceDescriptorV1.literal]: resourceDescriptorV1,
  [revocationsV1.literal]: revocationsV1,
};
