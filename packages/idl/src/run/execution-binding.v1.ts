// dsg.run.execution-binding/1
// Exact authority chain re-derived independently by the kernel and execution
// plane before any effect. No mutable discovery or latest lookup is permitted.
import { type Static, Type } from "@sinclair/typebox";
import { closed, Hex64, Orn, Reference, type ProfileEntry } from "../primitives.js";

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
  lease: Reference,
  trustView: Reference,
});
export type ExecutionBinding = Static<typeof ExecutionBindingSchema>;

export const executionBindingV1: ProfileEntry = {
  literal: EXECUTION_BINDING_PROFILE,
  rootDocument: "executionBinding",
  documents: { executionBinding: ExecutionBindingSchema },
};
