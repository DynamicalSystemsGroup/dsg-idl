// dsg.run.run-summary/1
// Owner: dsg-run (the plane writes it; the console and kernel status read
// it). A gate with no decision is waiting, never approved or refused.
import { type Static, Type } from "@sinclair/typebox";
import {
  closed,
  Hex64,
  NonEmptyString,
  PersonReference,
  UtcSecond,
  type ProfileEntry,
} from "../primitives.js";

export const RUN_SUMMARY_PROFILE = "dsg.run.run-summary/1" as const;

const RunSummaryDecisionSchemaValue = closed({
  outcome: Type.Union([Type.Literal("approved"), Type.Literal("refused")]),
  decider: PersonReference,
  decidedAt: UtcSecond,
  cause: Type.Union([NonEmptyString, Type.Null()]),
  byStandingOrder: Type.Boolean(),
});
export const RunSummaryDecisionSchema: typeof RunSummaryDecisionSchemaValue =
  RunSummaryDecisionSchemaValue;
export type RunSummaryDecision = Static<typeof RunSummaryDecisionSchema>;

const RunSummarySchemaValue = closed({
  profile: Type.Literal(RUN_SUMMARY_PROFILE),
  runId: NonEmptyString,
  experimentDigest: Hex64,
  requester: Type.Union([PersonReference, Type.Null()]),
  decision: Type.Union([RunSummaryDecisionSchema, Type.Null()]),
  waitingOn: Type.Union([NonEmptyString, Type.Null()]),
});
export const RunSummarySchema: typeof RunSummarySchemaValue = RunSummarySchemaValue;
export type RunSummary = Static<typeof RunSummarySchema>;

export const runSummaryV1: ProfileEntry = {
  literal: RUN_SUMMARY_PROFILE,
  rootShape: "summary",
  shapes: { summary: RunSummarySchema },
};
