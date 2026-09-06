// dsg.infra.signed-law/1
// Owner: dsg-infra (the S02 law producer; both prior copies were generated
// from dsg-infra policy/law-bundle.schema.json, source SHA-256
// bc3692395cf994567115c76d8fce66a7e9ebe7b2c50c70e1c83b8b10693a838c).
//
// The literal is the signing DOMAIN: it appears as the `domain` member of
// the canonical signature input (JCS of {domain, payload, payloadSha256,
// testOnly}), not as a field of the bundle itself; the bundle carries
// `kind` plus `schemaVersion` instead. Lifted verbatim from dsg-kernel
// packages/signing/src/law-schema.ts at ffafe305, byte-identical to the
// module registry copy at 1f8c994.
import { Type, type Static } from "@sinclair/typebox";
import type { ProfileEntry } from "../primitives.js";

export const SIGNED_LAW_PROFILE = "dsg.infra.signed-law/1" as const;
/** The signature-input domain member is exactly the profile literal. */
export const SIGNED_LAW_DOMAIN = SIGNED_LAW_PROFILE;

const nullableString = Type.Union([Type.String({ minLength: 1 }), Type.Null()]);
const authority = Type.Object(
  {
    issuerType: Type.Literal("human"),
    issuerReference: nullableString,
    designationReference: nullableString,
    signatureReference: nullableString,
    humanSignatureRequired: Type.Literal(true),
    releaseAutomationMayIssue: Type.Literal(false),
  },
  { additionalProperties: false },
);
const utcSecond = Type.String({
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
});
const standingOrder = Type.Object(
  {
    reference: nullableString,
    designationReference: nullableString,
    scopeReference: Type.String({ minLength: 1 }),
    issuedAt: Type.Union([utcSecond, Type.Null()]),
    expiresAt: Type.Union([utcSecond, Type.Null()]),
  },
  { additionalProperties: false },
);
const scope = Type.Object(
  {
    actions: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
    workloadClasses: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
    providers: Type.Array(Type.Literal("provider-neutral"), { minItems: 1, uniqueItems: true }),
    regions: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    resourceDescriptorVersion: Type.Literal("dsg.infra.resource-descriptor/1"),
  },
  { additionalProperties: false },
);
const validity = Type.Object(
  {
    clock: Type.Literal("UTC"),
    notBefore: Type.Union([utcSecond, Type.Null()]),
    notAfter: Type.Union([utcSecond, Type.Null()]),
  },
  { additionalProperties: false },
);
const revocation = Type.Object(
  {
    snapshotReference: nullableString,
    failClosed: Type.Literal(true),
    checks: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
  },
  { additionalProperties: false },
);
const ceiling = Type.Object(
  {
    unit: Type.String({ minLength: 1 }),
    period: Type.String({ minLength: 1 }),
    scope: Type.Union([Type.Literal("person"), Type.Literal("organization")]),
    value: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
const capabilityProfile = Type.Object(
  {
    lifecycle: Type.Union([Type.Literal("ephemeral"), Type.Literal("durable")]),
    machinePrefixes: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
    accelerators: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    maxRunSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    maxParallelism: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    maxGpuInstances: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    maxVcpus: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    network: Type.Literal("private"),
    externalIpAllowed: Type.Literal(false),
  },
  { additionalProperties: false },
);
const capabilities = Type.Object(
  {
    providerNeutral: Type.Literal(true),
    descriptorVersion: Type.Literal("dsg.infra.resource-descriptor/1"),
    profiles: Type.Record(Type.String(), capabilityProfile, { minProperties: 1 }),
  },
  { additionalProperties: false },
);
const priceProfile = Type.Object(
  {
    reference: Type.String({ minLength: 1 }),
    status: Type.Union([Type.Literal("unassigned"), Type.Literal("retained")]),
    currency: Type.Literal("USD"),
    unit: Type.Literal("micro_usd"),
    basis: Type.Literal("retained-conservative-on-demand"),
    rates: Type.Object(
      {
        vcpuSecond: Type.Optional(Type.Integer({ minimum: 0 })),
        memoryGiBSecond: Type.Optional(Type.Integer({ minimum: 0 })),
        gpuSecond: Type.Optional(Type.Integer({ minimum: 0 })),
        startup: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
    safetyFactorBps: Type.Union([Type.Integer({ minimum: 10000 }), Type.Null()]),
    validFrom: Type.Union([utcSecond, Type.Null()]),
    validUntil: Type.Union([utcSecond, Type.Null()]),
  },
  { additionalProperties: false },
);
const bootstrap = Type.Object(
  {
    mode: Type.Literal("finite-human-root"),
    rootReferences: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    allowedActions: Type.Array(
      Type.Union([
        Type.Literal("enroll_human_root"),
        Type.Literal("initialize_kernel_record"),
        Type.Literal("restore_kernel_record"),
        Type.Literal("cutover_single_writer"),
      ]),
      { minItems: 1, uniqueItems: true },
    ),
    maxUses: Type.Integer({ minimum: 1, maximum: 1 }),
    expiresAt: Type.Union([utcSecond, Type.Null()]),
    projectCreationAllowed: Type.Literal(false),
    requiresHumanSignature: Type.Literal(true),
    automationCanSatisfy: Type.Literal(false),
  },
  { additionalProperties: false },
);
const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const policyBundle = Type.Object(
  {
    digest: digest,
    manifest: Type.Record(
      Type.String({ pattern: "^policy/[A-Za-z0-9._-]+\\.rego$" }),
      Type.String({ pattern: "^[0-9a-f]{64}$" }),
      { additionalProperties: false, minProperties: 1 },
    ),
  },
  { additionalProperties: false },
);
const lawInputProfile = Type.Object(
  {
    requiresRunCeiling: Type.Boolean(),
    requiresExpirationLabel: Type.Boolean(),
    maxRunSeconds: Type.Integer({ minimum: 1 }),
    allowExternalIp: Type.Literal(false),
    machinePrefixes: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
    accelerators: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    maxGpuInstances: Type.Integer({ minimum: 0 }),
    maxTotalVcpus: Type.Integer({ minimum: 1 }),
    maxParallelism: Type.Integer({ minimum: 1 }),
    network: Type.Literal("private"),
  },
  { additionalProperties: false },
);
const lawInputs = Type.Object(
  {
    cloudflare: Type.Object(
      {
        approvedZoneId: Type.String({ minLength: 1 }),
        approvedAccountId: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    planLimits: Type.Object(
      {
        maxGpuInstances: Type.Integer({ minimum: 0 }),
        maxTotalVcpus: Type.Integer({ minimum: 1 }),
        approvedLocations: Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
    profiles: Type.Object(
      { compute: lawInputProfile, plane: lawInputProfile },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const evaluationInputs = Type.Object(
  { policyBundle: policyBundle, lawInputs: lawInputs },
  { additionalProperties: false },
);
const lawDocument = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    kind: Type.Literal("dsg.infra.law"),
    lawId: Type.String({ minLength: 1 }),
    status: Type.Union([Type.Literal("unissued"), Type.Literal("issued")]),
    authority: authority,
    standingOrder: standingOrder,
    scope: scope,
    validity: validity,
    revocation: revocation,
    ceilings: Type.Object(
      {
        gpuSecondsPerPersonUtcWeek: ceiling,
        usdMicroUnitsPerPersonUtcMonth: ceiling,
        usdMicroUnitsPerOrganizationUtcMonth: ceiling,
      },
      { additionalProperties: false },
    ),
    capabilities: capabilities,
    priceProfile: priceProfile,
    bootstrap: bootstrap,
    evaluationInputs: evaluationInputs,
  },
  { additionalProperties: false },
);
const signature = Type.Object(
  {
    algorithm: Type.Literal("Ed25519"),
    keyClass: Type.Union([
      Type.Literal("synthetic-test-only"),
      Type.Literal("human-authority"),
      Type.Literal("release-automation"),
    ]),
    publicKeyHex: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    signatureHex: Type.String({ pattern: "^[0-9a-f]{128}$" }),
  },
  { additionalProperties: false },
);
const signedLawBundle = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    kind: Type.Union([
      Type.Literal("dsg.infra.signed-law"),
      Type.Literal("dsg.infra.signed-law-fixture"),
    ]),
    testOnly: Type.Boolean(),
    deployedAuthority: Type.Boolean(),
    payload: lawDocument,
    canonicalPayload: Type.String({ minLength: 1 }),
    payloadSha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    canonicalSignatureInput: Type.String({ minLength: 1 }),
    signature: signature,
  },
  { additionalProperties: false },
);
export const SignedLawBundleSchema = signedLawBundle;
export type SignedLawBundle = Static<typeof SignedLawBundleSchema>;

export const signedLawV1: ProfileEntry = {
  literal: SIGNED_LAW_PROFILE,
  literalNote:
    "carried as the domain member of the canonical signature input, not as a bundle field",
  shapes: { bundle: SignedLawBundleSchema },
};
