// dsg.run.execution-binding/1
// Exact authority chain re-derived independently by the kernel and execution
// plane before any effect. No mutable discovery or latest lookup is permitted.
import { type Static, Type } from "@sinclair/typebox";
import { closed, Hex64, Orn, Reference, type ProfileEntry } from "../primitives.js";
import {
  AdmissionRecordSchema,
  ActiveSetSchema,
  BuildSelectionSchema,
  CatalogEntrySchema,
  ReleaseEligibilitySchema,
} from "../organization/release.v1.js";
import { OperationRequestSchema } from "./operation.v1.js";
import { JobClassSchema } from "./job-class.v1.js";
import {
  WorkloadArtifactSchema,
  WorkloadArtifactProvenanceSchema,
} from "./workload-artifact.v1.js";

export const EXECUTION_BINDING_PROFILE = "dsg.run.execution-binding/1" as const;

export const ExecutionBindingSchema = closed({
  profile: Type.Literal(EXECUTION_BINDING_PROFILE),
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("execution-binding"),
  installation: Orn,
  operation: Reference,
  activeSet: Reference,
  admission: Reference,
  organizationRelease: Reference,
  organizationBuild: Reference,
  selection: Reference,
  extensionRelease: Reference,
  workflow: Reference,
  jobClass: Reference,
  workloadArtifact: Reference,
  executableManifestSha256: Hex64,
  target: Reference,
  eventCatalog: Reference,
  law: Reference,
  reservation: Reference,
  trustView: Reference,
});
export type ExecutionBinding = Static<typeof ExecutionBindingSchema>;

export const ExecutionRequestEnvelopeSchema = closed({
  profile: Type.Literal(EXECUTION_BINDING_PROFILE),
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("execution-request-envelope"),
  operation: OperationRequestSchema,
  binding: ExecutionBindingSchema,
  jobClass: JobClassSchema,
  workloadArtifact: WorkloadArtifactSchema,
  workloadArtifactProvenance: WorkloadArtifactProvenanceSchema,
  admission: AdmissionRecordSchema,
  activeSet: ActiveSetSchema,
  selection: BuildSelectionSchema,
  catalogEntry: CatalogEntrySchema,
  releaseEligibility: ReleaseEligibilitySchema,
});
export type ExecutionRequestEnvelope = Static<typeof ExecutionRequestEnvelopeSchema>;

export const executionBindingV1: ProfileEntry = {
  literal: EXECUTION_BINDING_PROFILE,
  rootDocument: "executionBinding",
  documents: {
    executionBinding: ExecutionBindingSchema,
    executionRequestEnvelope: ExecutionRequestEnvelopeSchema,
  },
};
