// dsg.organization.release/1
// Semantic bodies and installation observations are separate documents.
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
import { ExtensionComponentKindSchema } from "../extension/release.v1.js";

export const ORGANIZATION_RELEASE_PROFILE = "dsg.organization.release/1" as const;
export const ORGANIZATION_RELEASE_CANONICALIZATION = "RFC8785-JCS-UTF8" as const;
const Identifier = Type.String({ pattern: "^[a-z][a-z0-9-]*(?:[.-][a-z0-9]+)*$" });
const Revision = Type.String({ pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" });
const Identifiers = () => Type.Array(Identifier, { uniqueItems: true });
const References = () => Type.Array(Reference, { uniqueItems: true });
const Evidence = () => Type.Array(Reference, { minItems: 1, uniqueItems: true });
const Header = {
  profile: Type.Literal(ORGANIZATION_RELEASE_PROFILE),
  schemaVersion: Type.Literal(1),
};

export const CompilerContractSchema = closed({
  profile: Type.String({ pattern: "^dsg\\.[a-z0-9.-]+/[1-9][0-9]*$" }),
  version: Type.String({ pattern: "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)$" }),
  implementation: Reference,
});
export type CompilerContract = Static<typeof CompilerContractSchema>;
export const DependencyKindSchema = Type.Union([
  Type.Literal("extension-release"),
  Type.Literal("component"),
  Type.Literal("idl-package"),
  Type.Literal("module-release"),
  Type.Literal("law-release"),
  Type.Literal("definition"),
  Type.Literal("workload-artifact"),
  Type.Literal("event-catalog"),
  Type.Literal("example"),
  Type.Literal("project"),
  Type.Literal("target"),
]);
export type DependencyKind = Static<typeof DependencyKindSchema>;
export const DependencyLockEntrySchema = closed({
  id: Identifier,
  kind: DependencyKindSchema,
  reference: Reference,
  mediaType: NonEmptyString,
  selectedMemberIds: Identifiers(),
  dependsOn: Identifiers(),
});
export type DependencyLockEntry = Static<typeof DependencyLockEntrySchema>;
// Entries and their dependency IDs are sorted. The closure is exactly the graph
// reachable from roots; graph validation is a consumer obligation, not uniqueItems.
export const DependencyLockSchema = closed({
  ...Header,
  kind: Type.Literal("dependency-lock"),
  canonicalization: Type.Literal(ORGANIZATION_RELEASE_CANONICALIZATION),
  roots: Identifiers(),
  entries: Type.Array(DependencyLockEntrySchema, { uniqueItems: true }),
  compiler: CompilerContractSchema,
});
export type DependencyLock = Static<typeof DependencyLockSchema>;

export const OrganizationReleaseMemberKindSchema = Type.Union([
  Type.Literal("publication"),
  Type.Literal("import"),
  Type.Literal("capability-admission"),
  Type.Literal("workflow-publication"),
  Type.Literal("contract-check"),
  Type.Literal("target-readiness"),
  Type.Literal("setup-condition"),
  Type.Literal("paid-execution-readiness"),
]);
export type OrganizationReleaseMemberKind = Static<typeof OrganizationReleaseMemberKindSchema>;
export const OrganizationReleaseMemberSchema = closed({
  id: Identifier,
  kind: OrganizationReleaseMemberKindSchema,
  required: Type.Boolean(),
  acceptableDispositions: Type.Array(NonEmptyString, { minItems: 1, uniqueItems: true }),
  subject: Reference,
});
export type OrganizationReleaseMember = Static<typeof OrganizationReleaseMemberSchema>;
export const ComponentBindingSchema = closed({
  id: Identifier,
  kind: ExtensionComponentKindSchema,
  reference: Reference,
});
export type ComponentBinding = Static<typeof ComponentBindingSchema>;
export const BuildSelectionSchema = closed({
  id: Identifier,
  selection: Reference,
  extensionRelease: Reference,
  members: Type.Array(ComponentBindingSchema, { minItems: 1, uniqueItems: true }),
});
export type BuildSelection = Static<typeof BuildSelectionSchema>;
export const BuildComponentSchema = closed({
  extensionRelease: Reference,
  memberId: Identifier,
  kind: ExtensionComponentKindSchema,
  reference: Reference,
  mediaType: NonEmptyString,
});
export type BuildComponent = Static<typeof BuildComponentSchema>;
export const OrganizationBuildSchema = closed({
  ...Header,
  kind: Type.Literal("organization-build"),
  organization: NonEmptyString,
  canonicalization: Type.Literal(ORGANIZATION_RELEASE_CANONICALIZATION),
  source: closed({ root: Reference, revision: Revision }),
  facts: closed({ name: NonEmptyString, purpose: NonEmptyString, space: NonEmptyString }),
  workspaceProfile: Reference,
  projects: Type.Array(closed({ id: Identifier, membership: Reference, revision: Revision }), {
    uniqueItems: true,
  }),
  sourceDocuments: Type.Array(
    closed({ path: NonEmptyString, sha256: Hex64, mediaType: NonEmptyString }),
    { minItems: 1, uniqueItems: true },
  ),
  selections: Type.Array(BuildSelectionSchema, { uniqueItems: true }),
  components: Type.Array(BuildComponentSchema, { uniqueItems: true }),
  typedReleases: Type.Array(DependencyLockEntrySchema, { uniqueItems: true }),
  dependencyLock: Reference,
  compiler: CompilerContractSchema,
  instructions: References(),
  handling: References(),
  releaseDeclarations: References(),
  releaseMembers: Type.Array(OrganizationReleaseMemberSchema, { uniqueItems: true }),
});
export type OrganizationBuild = Static<typeof OrganizationBuildSchema>;
// No self-reference or status: activation and supersession are record state.
export const OrganizationReleaseSchema = closed({
  ...Header,
  kind: Type.Literal("organization-release"),
  id: Identifier,
  organization: NonEmptyString,
  build: Reference,
  dependencyLock: Reference,
  selections: Identifiers(),
  members: Type.Array(OrganizationReleaseMemberSchema, { minItems: 1, uniqueItems: true }),
});
export type OrganizationRelease = Static<typeof OrganizationReleaseSchema>;

const ImportCommon = {
  ...Header,
  kind: Type.Literal("import-disposition"),
  installation: Orn,
  build: Reference,
  release: Reference,
  subject: Reference,
  observedAt: UtcSecond,
};
export const ImportDispositionSchema = Type.Union([
  closed({ ...ImportCommon, status: Type.Literal("pending") }),
  closed({
    ...ImportCommon,
    status: Type.Literal("verified"),
    disposition: Type.Union([Type.Literal("published"), Type.Literal("digest-match")]),
    evidence: Evidence(),
  }),
  closed({
    ...ImportCommon,
    status: Type.Literal("staged"),
    disposition: Type.Literal("captured"),
    evidence: Evidence(),
  }),
  closed({
    ...ImportCommon,
    status: Type.Literal("refused"),
    disposition: Type.Union([
      Type.Literal("digest-mismatch"),
      Type.Literal("missing"),
      Type.Literal("unsupported"),
    ]),
    reason: NonEmptyString,
    evidence: Evidence(),
  }),
]);
export type ImportDisposition = Static<typeof ImportDispositionSchema>;
export const ReleaseStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("retired"),
  Type.Literal("revoked"),
]);
export type ReleaseStatus = Static<typeof ReleaseStatusSchema>;
export const ReleaseStatusObservationSchema = closed({
  ...Header,
  kind: Type.Literal("release-status-observation"),
  subject: Reference,
  registry: Reference,
  trustView: Reference,
  status: ReleaseStatusSchema,
  effectiveAt: UtcSecond,
  observedAt: UtcSecond,
  evidence: Evidence(),
});
export type ReleaseStatusObservation = Static<typeof ReleaseStatusObservationSchema>;
// A status evaluation pins both the observation and the consumer's current trust
// input. Retirement permits existing active execution; revocation never does.
export const ReleaseEligibilitySchema = closed({
  ...Header,
  kind: Type.Literal("release-eligibility"),
  release: Reference,
  operation: Type.Union([
    Type.Literal("resolve"),
    Type.Literal("select"),
    Type.Literal("import"),
    Type.Literal("admit"),
    Type.Literal("activate"),
    Type.Literal("execute"),
  ]),
  observation: ReleaseStatusObservationSchema,
  trustView: Reference,
  activeSet: Type.Union([Reference, Type.Null()]),
});
export type ReleaseEligibility = Static<typeof ReleaseEligibilitySchema>;
export const ApprovedUseSchema = closed({ use: NonEmptyString, binding: Reference });
export type ApprovedUse = Static<typeof ApprovedUseSchema>;
const AdmissionCommon = {
  ...Header,
  kind: Type.Literal("admission-record"),
  id: Identifier,
  installation: Orn,
  organization: NonEmptyString,
  build: Reference,
  release: Reference,
  selectionId: Identifier,
  extensionRelease: Reference,
  evaluatingCase: Reference,
  decision: Reference,
  authority: Reference,
  fence: Reference,
  revision: SafeInt,
  decidedAt: UtcSecond,
};
export const AdmissionRecordSchema = Type.Union([
  closed({
    ...AdmissionCommon,
    status: Type.Literal("admitted"),
    components: Type.Array(ComponentBindingSchema, { minItems: 1, uniqueItems: true }),
    approvedUses: Type.Array(ApprovedUseSchema, { minItems: 1, uniqueItems: true }),
    bindings: Evidence(),
    evidence: Evidence(),
  }),
  closed({
    ...AdmissionCommon,
    status: Type.Literal("refused"),
    components: Type.Array(ComponentBindingSchema, { uniqueItems: true }),
    reason: NonEmptyString,
    evidence: Evidence(),
  }),
]);
export type AdmissionRecord = Static<typeof AdmissionRecordSchema>;
const AdmissionObservationCommon = {
  ...Header,
  kind: Type.Literal("admission-status-observation"),
  admission: Reference,
  decision: Reference,
  evidence: Evidence(),
  observedAt: UtcSecond,
};
export const AdmissionStatusObservationSchema = Type.Union([
  closed({
    ...AdmissionObservationCommon,
    status: Type.Literal("suspended"),
    reason: NonEmptyString,
  }),
  closed({
    ...AdmissionObservationCommon,
    status: Type.Literal("superseded"),
    replacement: Reference,
  }),
  closed({
    ...AdmissionObservationCommon,
    status: Type.Literal("revoked"),
    governedRevocation: Reference,
    trustView: Reference,
    reason: NonEmptyString,
  }),
]);
export type AdmissionStatusObservation = Static<typeof AdmissionStatusObservationSchema>;
const MemberObservationCommon = {
  ...Header,
  kind: Type.Literal("member-observation"),
  installation: Orn,
  build: Reference,
  release: Reference,
  memberId: Identifier,
  memberKind: OrganizationReleaseMemberKindSchema,
  subject: Reference,
  evidence: Evidence(),
  observedAt: UtcSecond,
};
export const MemberObservationSchema = Type.Union([
  closed({
    ...MemberObservationCommon,
    disposition: Type.Union([Type.Literal("ready"), Type.Literal("verified")]),
  }),
  closed({
    ...MemberObservationCommon,
    disposition: Type.Union([
      Type.Literal("refused"),
      Type.Literal("suspended"),
      Type.Literal("revoked"),
    ]),
    reason: NonEmptyString,
  }),
]);
export type MemberObservation = Static<typeof MemberObservationSchema>;
export const ActiveMemberSchema = closed({
  selectionId: Identifier,
  memberId: Identifier,
  extensionRelease: Reference,
  components: Type.Array(ComponentBindingSchema, { minItems: 1, uniqueItems: true }),
  admission: Reference,
});
export type ActiveMember = Static<typeof ActiveMemberSchema>;
export const ActiveSetSchema = closed({
  ...Header,
  kind: Type.Literal("active-set"),
  installation: Orn,
  organization: NonEmptyString,
  release: Reference,
  build: Reference,
  predecessor: Type.Union([Reference, Type.Null()]),
  members: Type.Array(ActiveMemberSchema, { uniqueItems: true }),
  memberObservations: Evidence(),
  policies: References(),
  configuration: References(),
  activatingCase: Reference,
  authority: Reference,
  activatingDecision: Reference,
  fence: Reference,
  revision: SafeInt,
  activatedAt: UtcSecond,
});
export type ActiveSet = Static<typeof ActiveSetSchema>;
const CatalogEntryCommon = {
  id: Identifier,
  activeSet: Reference,
  selectionId: Identifier,
  memberId: Identifier,
  extensionRelease: Reference,
  workflow: Reference,
  example: Type.Union([Reference, Type.Null()]),
  jobClass: Type.Union([Reference, Type.Null()]),
  workloadArtifact: Type.Union([Reference, Type.Null()]),
  contracts: References(),
  availabilityEvidence: Evidence(),
};
export const CatalogEntrySchema = Type.Union([
  closed({ ...CatalogEntryCommon, availability: Type.Literal("available") }),
  closed({
    ...CatalogEntryCommon,
    availability: Type.Literal("unavailable"),
    unavailableReason: NonEmptyString,
  }),
]);
export type CatalogEntry = Static<typeof CatalogEntrySchema>;
export const CatalogSchema = closed({
  ...Header,
  kind: Type.Literal("catalog"),
  activeSet: Reference,
  entries: Type.Array(CatalogEntrySchema, { uniqueItems: true }),
});
export type Catalog = Static<typeof CatalogSchema>;
export const BoundAttestationSchema = closed({
  ...Header,
  kind: Type.Literal("bound-attestation"),
  subject: Reference,
  issuer: Orn,
  evidence: Reference,
  verification: Type.Union([
    Type.Literal("publisher-signature"),
    Type.Literal("registry-recognition"),
    Type.Literal("source-provenance"),
    Type.Literal("component-digest"),
  ]),
  observedAt: UtcSecond,
  signature: NonEmptyString,
});
export type BoundAttestation = Static<typeof BoundAttestationSchema>;
export const organizationReleaseV1: ProfileEntry = {
  literal: ORGANIZATION_RELEASE_PROFILE,
  documents: {
    dependencyLock: DependencyLockSchema,
    organizationBuild: OrganizationBuildSchema,
    importDisposition: ImportDispositionSchema,
    releaseStatusObservation: ReleaseStatusObservationSchema,
    releaseEligibility: ReleaseEligibilitySchema,
    organizationRelease: OrganizationReleaseSchema,
    admissionRecord: AdmissionRecordSchema,
    admissionStatusObservation: AdmissionStatusObservationSchema,
    memberObservation: MemberObservationSchema,
    activeSet: ActiveSetSchema,
    catalog: CatalogSchema,
    boundAttestation: BoundAttestationSchema,
  },
};
