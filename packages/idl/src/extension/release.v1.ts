// dsg.extension.release/1
// Semantic, immutable Extension Release manifests. Publication signatures and
// observations are separate envelopes; this body never self-references its
// digest and never carries transport or verification outcomes.
import { type Static, Type } from "@sinclair/typebox";
import {
  closed,
  Hex64,
  NonEmptyString,
  Orn,
  Reference,
  SafeInt,
  UtcSecond,
  type ProfileEntry,
} from "../primitives.js";

export const EXTENSION_RELEASE_PROFILE = "dsg.extension.release/1" as const;
export const EXTENSION_RELEASE_CANONICALIZATION = "RFC8785-JCS-UTF8" as const;

const IdentifierSchema = Type.String({ pattern: "^[a-z][a-z0-9-]*(?:[.-][a-z0-9]+)*$" });
const IdentifierSet = () => Type.Array(IdentifierSchema, { uniqueItems: true });
const RequiredStrings = () => Type.Array(NonEmptyString, { minItems: 1, uniqueItems: true });

export const ExtensionReleaseReferenceSchema = Reference;
export type ExtensionReleaseReference = Static<typeof ExtensionReleaseReferenceSchema>;

export const ExtensionComponentKindSchema = Type.Union([
  Type.Literal("workflow"),
  Type.Literal("example"),
  Type.Literal("contract"),
  Type.Literal("job-class"),
  Type.Literal("workload-artifact"),
  Type.Literal("event-catalog"),
  Type.Literal("connector"),
  Type.Literal("module"),
  Type.Literal("check"),
  Type.Literal("vocabulary"),
  Type.Literal("assurance"),
  Type.Literal("documentation"),
]);
export type ExtensionComponentKind = Static<typeof ExtensionComponentKindSchema>;

export const ExtensionComponentReferenceSchema = Reference;
export type ExtensionComponentReference = Static<typeof ExtensionComponentReferenceSchema>;

const ComponentProperties = {
  id: IdentifierSchema,
  reference: ExtensionComponentReferenceSchema,
  mediaType: NonEmptyString,
  required: Type.Boolean(),
  dependsOn: IdentifierSet(),
};

export const ExtensionComponentSchema = closed({
  ...ComponentProperties,
  kind: ExtensionComponentKindSchema,
});
export type ExtensionComponent = Static<typeof ExtensionComponentSchema>;

const ComputeComponentKindSchema = Type.Union([
  Type.Literal("workflow"),
  Type.Literal("example"),
  Type.Literal("contract"),
  Type.Literal("job-class"),
  Type.Literal("workload-artifact"),
  Type.Literal("event-catalog"),
  Type.Literal("connector"),
  Type.Literal("module"),
  Type.Literal("check"),
  Type.Literal("vocabulary"),
  Type.Literal("assurance"),
  Type.Literal("documentation"),
]);
const ComputeComponentSchema = closed({
  ...ComponentProperties,
  kind: ComputeComponentKindSchema,
});
const NonComputeComponentKindSchema = Type.Union([
  Type.Literal("workflow"),
  Type.Literal("example"),
  Type.Literal("contract"),
  Type.Literal("event-catalog"),
  Type.Literal("connector"),
  Type.Literal("module"),
  Type.Literal("check"),
  Type.Literal("vocabulary"),
  Type.Literal("assurance"),
  Type.Literal("documentation"),
]);
const NonComputeComponentSchema = closed({
  ...ComponentProperties,
  kind: NonComputeComponentKindSchema,
});

export const ExtensionDependencyKindSchema = Type.Union([
  Type.Literal("extension-release"),
  Type.Literal("idl-package"),
  Type.Literal("module-release"),
  Type.Literal("law-release"),
  Type.Literal("event-catalog"),
  Type.Literal("example-release"),
  Type.Literal("target-release"),
]);
export type ExtensionDependencyKind = Static<typeof ExtensionDependencyKindSchema>;

export const ExtensionDependencySchema = closed({
  id: IdentifierSchema,
  kind: ExtensionDependencyKindSchema,
  reference: Reference,
  required: Type.Boolean(),
});
export type ExtensionDependency = Static<typeof ExtensionDependencySchema>;

/** Shared requirements contain no compute-only workload obligations. */
export const ExtensionRequirementsSchema = closed({
  idlProfiles: Type.Array(NonEmptyString, { uniqueItems: true }),
  roles: Type.Array(NonEmptyString, { uniqueItems: true }),
  qualification: Type.Optional(Reference),
  handling: Type.Union([
    Type.Literal("public"),
    Type.Literal("restricted"),
    Type.Literal("confidential"),
  ]),
});
export type ExtensionRequirements = Static<typeof ExtensionRequirementsSchema>;

export const ExtensionComputeRequirementsSchema = closed({
  idlProfiles: Type.Array(NonEmptyString, { uniqueItems: true }),
  roles: Type.Array(NonEmptyString, { uniqueItems: true }),
  qualification: Type.Optional(Reference),
  handling: Type.Union([
    Type.Literal("public"),
    Type.Literal("restricted"),
    Type.Literal("confidential"),
  ]),
  supportedPlatforms: RequiredStrings(),
  targets: Type.Array(Reference, { uniqueItems: true }),
  isolation: Type.Union([Type.Literal("ephemeral"), Type.Literal("dedicated")]),
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
export type ExtensionComputeRequirements = Static<typeof ExtensionComputeRequirementsSchema>;

export const ExtensionBoundsSchema = closed({
  maxDurationSeconds: SafeInt,
  maxParallelism: SafeInt,
  maxUsdMicroUnits: SafeInt,
});
export type ExtensionBounds = Static<typeof ExtensionBoundsSchema>;

const ReleaseIdentity = {
  profile: Type.Literal(EXTENSION_RELEASE_PROFILE),
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("extension-release"),
  publisher: Orn,
  name: IdentifierSchema,
  version: Type.String({ pattern: "^(?:0|[1-9][0-9]*)\\.[0-9]+\\.[0-9]+$" }),
  /** Derived from publisher, namespace, name, and version; never from this
   * body's digest, so canonical hashing has no self-reference. */
  releaseOrn: Orn,
  namespace: NonEmptyString,
  source: closed({
    repository: NonEmptyString,
    revision: Type.String({ pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" }),
  }),
  build: closed({ provenance: Reference, sourceDigest: Hex64 }),
  canonicalization: Type.Literal(EXTENSION_RELEASE_CANONICALIZATION),
  dependencies: Type.Array(ExtensionDependencySchema, { uniqueItems: true }),
};

const ComputeReleaseSchema = closed({
  ...ReleaseIdentity,
  compute: Type.Literal(true),
  components: Type.Array(ComputeComponentSchema, { minItems: 1, uniqueItems: true }),
  requirements: ExtensionComputeRequirementsSchema,
  bounds: ExtensionBoundsSchema,
});
const NonComputeReleaseSchema = closed({
  ...ReleaseIdentity,
  compute: Type.Literal(false),
  components: Type.Array(NonComputeComponentSchema, { minItems: 1, uniqueItems: true }),
  requirements: ExtensionRequirementsSchema,
});
export const ExtensionReleaseSchema = Type.Union([ComputeReleaseSchema, NonComputeReleaseSchema]);
export type ExtensionRelease = Static<typeof ExtensionReleaseSchema>;

/** Detached publisher envelope. `release.sha256` and `bodySha256` both pin
 * the RFC 8785 JCS UTF-8 bytes of the semantic release body. */
export const ExtensionReleaseSignatureSchema = closed({
  profile: Type.Literal(EXTENSION_RELEASE_PROFILE),
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("extension-release-signature"),
  release: ExtensionReleaseReferenceSchema,
  publisher: Orn,
  publicKey: Hex64,
  bodySha256: Hex64,
  canonicalization: Type.Literal(EXTENSION_RELEASE_CANONICALIZATION),
  signature: NonEmptyString,
  signedAt: UtcSecond,
});
export type ExtensionReleaseSignature = Static<typeof ExtensionReleaseSignatureSchema>;

export const extensionReleaseV1: ProfileEntry = {
  literal: EXTENSION_RELEASE_PROFILE,
  rootDocument: "release",
  documents: {
    release: ExtensionReleaseSchema,
    signature: ExtensionReleaseSignatureSchema,
  },
};
