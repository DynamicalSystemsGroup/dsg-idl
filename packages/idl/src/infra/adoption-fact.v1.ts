// dsg.infra.adoption-fact/1
// Owner: dsg-infra (governance/adoption.py is the producer: it verifies an
// exported kernel bootstrap record snapshot offline - canonical digest,
// event hash chain, stream heads, artifact bytes - and emits the accepted
// root-authorizing operation as this fact). The tofu baseline root
// consumes it and re-validates independently: its deployment-specific
// conditions (which root string, testOnly false for the real baseline)
// are that root's own law, deliberately NOT part of this shape - a
// synthetic testOnly fact is a valid FACT, just never a valid deployed
// authorization.
//
// Lifted from dsg-infra governance/adoption.py at e9d9501 and
// infrastructure/environments/dsg-run/adoption.tf (S01, commit fccf709).
import { type Static, Type } from "@sinclair/typebox";
import { closed, Hex64, NonEmptyString, Orn, type ProfileEntry } from "../primitives.js";

export const ADOPTION_FACT_PROFILE = "dsg.infra.adoption-fact/1" as const;

const AdoptionFactSchemaValue = closed({
  profile: Type.Literal(ADOPTION_FACT_PROFILE),
  /** The root the record names as active baseline owner. */
  root: NonEmptyString,
  lineage: NonEmptyString,
  /** The accepted root-authorizing operation. */
  operation: NonEmptyString,
  /** Count of accepted root operations; ownership needs at least one. */
  generation: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  /** Canonical digest of the verified record snapshot. */
  snapshotSha256: Hex64,
  /** initialize establishes the first owner; cutover transfers it. restore
   *  and enrollment move custody and human roots, never root ownership. */
  action: Type.Union([
    Type.Literal("initialize_kernel_record"),
    Type.Literal("cutover_single_writer"),
  ]),
  signer: Orn,
  humanRoot: NonEmptyString,
  testOnly: Type.Boolean(),
});
export const AdoptionFactSchema: typeof AdoptionFactSchemaValue = AdoptionFactSchemaValue;
export type AdoptionFact = Static<typeof AdoptionFactSchema>;

export const adoptionFactV1: ProfileEntry = {
  literal: ADOPTION_FACT_PROFILE,
  rootDocument: "fact",
  documents: { fact: AdoptionFactSchema },
};
