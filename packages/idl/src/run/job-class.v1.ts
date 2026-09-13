// dsg.run.job-class/1
// Immutable execution semantics shared by the organization compiler, kernel,
// and execution plane. Catalog detail APIs resolve these exact bytes.
import { type Static, Type } from "@sinclair/typebox";
import { closed, NonEmptyString, Reference, SafeInt, type ProfileEntry } from "../primitives.js";

export const JOB_CLASS_PROFILE = "dsg.run.job-class/1" as const;

const RequiredReferences = () => Type.Array(Reference, { minItems: 1, uniqueItems: true });
const RequiredStrings = () => Type.Array(NonEmptyString, { minItems: 1, uniqueItems: true });

export const JobClassBoundsSchema = closed({
  maxRunSeconds: SafeInt,
  maxGpuSeconds: SafeInt,
  maxParallelism: SafeInt,
  maxUsdMicroUnits: SafeInt,
});
export type JobClassBounds = Static<typeof JobClassBoundsSchema>;

export const JobClassSchema = closed({
  profile: Type.Literal(JOB_CLASS_PROFILE),
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("job-class"),
  id: NonEmptyString,
  executor: NonEmptyString,
  mode: NonEmptyString,
  modeEnvironmentVariable: NonEmptyString,
  workloadArtifact: Reference,
  platforms: RequiredStrings(),
  isolation: Type.Union([Type.Literal("ephemeral"), Type.Literal("dedicated")]),
  inputContracts: RequiredReferences(),
  outputContracts: RequiredReferences(),
  eventCatalog: Reference,
  decisionRequirements: RequiredReferences(),
  bounds: JobClassBoundsSchema,
  handling: Type.Union([
    Type.Literal("public"),
    Type.Literal("restricted"),
    Type.Literal("confidential"),
  ]),
  retention: Type.Union([
    Type.Literal("ephemeral"),
    Type.Literal("bounded"),
    Type.Literal("durable"),
  ]),
  completion: Reference,
  teardown: Reference,
  evidence: Reference,
  replay: Reference,
});
export type JobClass = Static<typeof JobClassSchema>;

export const jobClassV1: ProfileEntry = {
  literal: JOB_CLASS_PROFILE,
  rootDocument: "jobClass",
  documents: { jobClass: JobClassSchema },
};
