// dsg.run.request/1
// Owner: dsg-run (POST /requests). The CLI builds this document from an
// experiment; the plane fills the requester from the door's assertion and
// never from a field on this shape.
import { type Static, Type } from "@sinclair/typebox";
import {
  closed,
  Hex64,
  NonEmptyString,
  Reference,
  SafeInt,
  type ProfileEntry,
} from "../primitives.js";

export const REQUEST_PROFILE = "dsg.run.request/1" as const;

const ExperimentRefSchemaValue = closed({
  digest: Hex64,
  title: NonEmptyString,
  workloadClass: NonEmptyString,
});
export const ExperimentRefSchema: typeof ExperimentRefSchemaValue = ExperimentRefSchemaValue;
export type ExperimentRef = Static<typeof ExperimentRefSchema>;

const RequestCeilingsSchemaValue = closed({
  maxRunSeconds: SafeInt,
  maxGpuSeconds: SafeInt,
  maxParallelism: SafeInt,
  costBoundMicroUsd: SafeInt,
});
export const RequestCeilingsSchema: typeof RequestCeilingsSchemaValue = RequestCeilingsSchemaValue;
export type RequestCeilings = Static<typeof RequestCeilingsSchema>;

const RunRequestSchemaValue = closed({
  profile: Type.Literal(REQUEST_PROFILE),
  experiment: ExperimentRefSchema,
  workload: Reference,
  inputs: Type.Array(Reference, { minItems: 1 }),
  ceilings: RequestCeilingsSchema,
  purpose: NonEmptyString,
  window: NonEmptyString,
});
export const RunRequestSchema: typeof RunRequestSchemaValue = RunRequestSchemaValue;
export type RunRequest = Static<typeof RunRequestSchema>;

export const requestV1: ProfileEntry = {
  literal: REQUEST_PROFILE,
  rootDocument: "request",
  documents: { request: RunRequestSchema },
};
