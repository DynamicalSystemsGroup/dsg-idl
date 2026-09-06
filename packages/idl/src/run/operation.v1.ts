// dsg.run.operation/1
// Owner: dsg-run (the protocol listener accepts the request and answers
// the receipt; the kernel validates, records and reads back).
//
// Closed, versioned compute-operation vocabulary shared by the kernel and
// the dsg.run plane. The document is deliberately references-only: payload
// bytes remain retained artifacts, while this request carries the immutable
// identity, generation fence, law, reservation and plan digest.
//
// The envelope digest bound at dispatch (M010) is sha256 over the RFC 8785
// canonical form of the complete OperationRequest; the digest vectors in
// the conformance package pin that meaning.
//
// Lifted verbatim from dsg-kernel packages/core/src/operation.ts at commit
// 0f8d64d7 (equal, field for field, to dsg-run service/src/protocol/
// schemas.ts 134-246 - the R01 cross-validation held). Known /2 candidate,
// kept loose here because a released /1 is frozen: acceptedAt is
// minLength 1, not an exact UTC second, and the plane emits fractional
// seconds today.
import { type Static, Type } from "@sinclair/typebox";
import {
  closed,
  Hex64,
  NonEmptyString,
  Reference,
  SafeInt,
  type ProfileEntry,
} from "../primitives.js";

export const OPERATION_PROFILE = "dsg.run.operation/1" as const;

const ExecutionResourcesSchemaValue = closed({
  maxGpuSeconds: SafeInt,
  maxRunSeconds: SafeInt,
  maxParallelism: SafeInt,
});
export const ExecutionResourcesSchema: typeof ExecutionResourcesSchemaValue =
  ExecutionResourcesSchemaValue;
export type ExecutionResources = Static<typeof ExecutionResourcesSchema>;

const ExecutionLawSchemaValue = closed({
  bundle: Reference,
  registryRelease: Reference,
});
export const ExecutionLawSchema: typeof ExecutionLawSchemaValue = ExecutionLawSchemaValue;
export type ExecutionLaw = Static<typeof ExecutionLawSchema>;

const ExecutionDocumentSchemaValue = closed({
  schemaVersion: Type.Literal(1),
  classContract: Reference,
  law: ExecutionLawSchema,
  workload: Reference,
  inputs: Type.Array(Reference),
  resources: ExecutionResourcesSchema,
  costBound: Reference,
  placement: Reference,
  results: Reference,
  secrets: Type.Array(Reference),
});
export const ExecutionDocumentSchema: typeof ExecutionDocumentSchemaValue =
  ExecutionDocumentSchemaValue;
export type ExecutionDocument = Static<typeof ExecutionDocumentSchema>;

const OperationBeforeSchemaValue = closed({
  operationId: Type.Union([NonEmptyString, Type.Null()]),
  planDigest: Type.Union([Hex64, Type.Null()]),
});
export const OperationBeforeSchema: typeof OperationBeforeSchemaValue = OperationBeforeSchemaValue;
export type OperationBefore = Static<typeof OperationBeforeSchema>;

const OperationRequestSchemaValue = closed({
  profile: Type.Literal(OPERATION_PROFILE),
  operationId: NonEmptyString,
  case: Reference,
  workspace: NonEmptyString,
  expectedGeneration: SafeInt,
  before: OperationBeforeSchema,
  planDigest: Hex64,
  document: ExecutionDocumentSchema,
  authority: Reference,
  reservation: Reference,
});
export const OperationRequestSchema: typeof OperationRequestSchemaValue =
  OperationRequestSchemaValue;
export type OperationRequest = Static<typeof OperationRequestSchema>;

const AcceptedSchemaValue = closed({
  profile: Type.Literal(OPERATION_PROFILE),
  operationId: NonEmptyString,
  actionId: NonEmptyString,
  generation: SafeInt,
  planDigest: Hex64,
  acceptedAt: NonEmptyString,
});
export const AcceptedSchema: typeof AcceptedSchemaValue = AcceptedSchemaValue;
export type Accepted = Static<typeof AcceptedSchema>;

const OperationExecutionSchemaValue = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("canceled"),
  Type.Literal("unknown"),
]);
export const OperationExecutionSchema: typeof OperationExecutionSchemaValue =
  OperationExecutionSchemaValue;
export type OperationExecution = Static<typeof OperationExecutionSchema>;

const OperationCleanupSchemaValue = Type.Union([
  Type.Literal("pending"),
  Type.Literal("present"),
  Type.Literal("absent"),
  Type.Literal("unknown"),
]);
export const OperationCleanupSchema: typeof OperationCleanupSchemaValue =
  OperationCleanupSchemaValue;
export type OperationCleanup = Static<typeof OperationCleanupSchema>;

const OperationEvidenceSchemaValue = Type.Union([Type.Literal("pending"), Type.Literal("ready")]);
export const OperationEvidenceSchema: typeof OperationEvidenceSchemaValue =
  OperationEvidenceSchemaValue;
export type OperationEvidence = Static<typeof OperationEvidenceSchema>;

const OperationCostSchemaValue = Type.Union([
  Type.Literal("reserved"),
  Type.Literal("provisional"),
  Type.Literal("reconciled"),
]);
export const OperationCostSchema: typeof OperationCostSchemaValue = OperationCostSchemaValue;
export type OperationCost = Static<typeof OperationCostSchema>;

const ReadbackSchemaValue = closed({
  operationId: NonEmptyString,
  generation: SafeInt,
  planDigest: Hex64,
  execution: OperationExecutionSchema,
  cleanup: OperationCleanupSchema,
  evidence: OperationEvidenceSchema,
  evidenceRef: Type.Union([Reference, Type.Null()]),
  cost: OperationCostSchema,
});
export const ReadbackSchema: typeof ReadbackSchemaValue = ReadbackSchemaValue;
export type Readback = Static<typeof ReadbackSchema>;

// I-001 names the status as the same closed readback shape. Keeping this
// alias prevents callers from inventing a second status wire contract.
export const OperationStatusSchema = ReadbackSchema;
export type OperationStatus = Readback;

export const operationV1: ProfileEntry = {
  literal: OPERATION_PROFILE,
  shapes: {
    request: OperationRequestSchema,
    accepted: AcceptedSchema,
    readback: ReadbackSchema,
  },
};
