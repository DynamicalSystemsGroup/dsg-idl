// dsg.kernel.ordinary-authority/1
// Owner: dsg-kernel (K02, M029/M030). The canonical ordinary-rights
// artifact: who may issue law, exactly what they may permit, for how long,
// and under which three ceilings. Closed and versioned; every set is an
// explicit allow-list, never an omitted-means-unlimited default. A
// verified finite enroll_human_root intent binds this document's digest as
// both plan and resource spec. The revocation view a standing-order check
// runs against stays in the kernel: independently supplied input, not a
// wire document.
//
// Lifted verbatim from dsg-kernel packages/signing/src/enrollment.ts at
// 00b33ac1.
import { type Static, Type } from "@sinclair/typebox";
import { closed, Hex64, NonEmptyString, Orn, UtcSecond, type ProfileEntry } from "../primitives.js";

export const ORDINARY_AUTHORITY_PROFILE = "dsg.kernel.ordinary-authority/1" as const;

const names = Type.Array(NonEmptyString, { minItems: 1, uniqueItems: true });
const ceilingValue = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

const OrdinaryAuthoritySchemaValue = closed({
  version: Type.Literal(ORDINARY_AUTHORITY_PROFILE),
  reference: NonEmptyString,
  actor: Orn,
  publicKeyHex: Hex64,
  keyClass: Type.Union([Type.Literal("synthetic-test-only"), Type.Literal("human-authority")]),
  designation: closed({
    role: Type.Literal("law-issuer"),
    designationReference: NonEmptyString,
  }),
  scope: closed({
    scopeReference: NonEmptyString,
    actions: names,
    workloadClasses: names,
    regions: names,
  }),
  validity: closed({ notBefore: UtcSecond, notAfter: UtcSecond }),
  ceilings: closed({
    gpuSecondsPerPersonUtcWeek: ceilingValue,
    usdMicroUnitsPerPersonUtcMonth: ceilingValue,
    usdMicroUnitsPerOrganizationUtcMonth: ceilingValue,
  }),
  revoked: Type.Boolean(),
});
export const OrdinaryAuthoritySchema: typeof OrdinaryAuthoritySchemaValue =
  OrdinaryAuthoritySchemaValue;
export type OrdinaryAuthority = Static<typeof OrdinaryAuthoritySchema>;

export const ordinaryAuthorityV1: ProfileEntry = {
  literal: ORDINARY_AUTHORITY_PROFILE,
  rootDocument: "authority",
  documents: { authority: OrdinaryAuthoritySchema },
};
