// dsg.organization.source/2
// Closed authoring contracts for an organization source tree. These declarations
// describe reviewed inputs only: they contain no live principals, grants,
// admissions, activation state, or deployment authority.
import { type Static, Type } from "@sinclair/typebox";
import { closed, NonEmptyString, SafeInt, type ProfileEntry } from "../primitives.js";

export const ORGANIZATION_SOURCE_PROFILE = "dsg.organization.source/2" as const;

export const OrganizationSpaceSchema = Type.String({
  pattern: "^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+$",
});

/** A path interpreted relative to the organization source root. Filesystem
 * containment and symlink checks belong to the consumer that opens it. */
export const OrganizationDocumentPathSchema = Type.String({
  minLength: 1,
  pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*//)(?!.*\\\\).+$",
});

export const OrganizationSourceLocationSchema = closed({
  repository: NonEmptyString,
  ref: NonEmptyString,
  subdirectory: OrganizationDocumentPathSchema,
});
export type OrganizationSourceLocation = Static<typeof OrganizationSourceLocationSchema>;
const OrganizationSourceLocationV1Schema = closed({
  repository: Type.String(),
  ref: Type.String(),
  subdirectory: Type.String(),
});
export type OrganizationSourceLocationV1 = Static<typeof OrganizationSourceLocationV1Schema>;

export const ProjectSourceSchema = closed({
  repository: NonEmptyString,
  revision: Type.String({ pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" }),
});
export type ProjectSource = Static<typeof ProjectSourceSchema>;

const UniquePaths = () => Type.Array(OrganizationDocumentPathSchema, { uniqueItems: true });
const UniqueNames = () => Type.Array(NonEmptyString, { uniqueItems: true });

/** Frozen compatibility shape. Version one is loaded only through the explicit
 * compatibility path; it is never silently reinterpreted as version two. */
export const OrganizationRootV1Schema = closed({
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("organization"),
  org: NonEmptyString,
  space: OrganizationSpaceSchema,
  identity: closed({
    principals: NonEmptyString,
    qualifications: NonEmptyString,
    designations: NonEmptyString,
  }),
  policies: NonEmptyString,
  vocabulary: NonEmptyString,
  admissions: NonEmptyString,
  deployment: NonEmptyString,
  source: Type.Optional(OrganizationSourceLocationV1Schema),
});
export type OrganizationRootV1 = Static<typeof OrganizationRootV1Schema>;

export const OrganizationInstructionSchema = closed({
  layer: Type.Union([
    Type.Literal("constitution"),
    Type.Literal("profile"),
    Type.Literal("project"),
  ]),
  source: OrganizationDocumentPathSchema,
  provenance: OrganizationDocumentPathSchema,
});
export type OrganizationInstruction = Static<typeof OrganizationInstructionSchema>;

/** The generic root requires only stable identity, accountability, purpose and
 * a selected profile. Optional declaration groups become required only when
 * that profile says so. */
export const OrganizationRootSchema = closed({
  schemaVersion: Type.Literal(2),
  kind: Type.Literal("organization"),
  org: NonEmptyString,
  space: OrganizationSpaceSchema,
  owner: closed({
    responsibility: NonEmptyString,
    qualification: Type.Optional(OrganizationDocumentPathSchema),
    designation: Type.Optional(OrganizationDocumentPathSchema),
  }),
  purpose: NonEmptyString,
  profile: closed({
    document: OrganizationDocumentPathSchema,
    facts: Type.Record(
      Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
      OrganizationDocumentPathSchema,
      { additionalProperties: false },
    ),
  }),
  identity: Type.Optional(
    closed({
      principals: Type.Optional(OrganizationDocumentPathSchema),
      qualifications: Type.Optional(OrganizationDocumentPathSchema),
      designations: Type.Optional(OrganizationDocumentPathSchema),
      eligibility: Type.Optional(OrganizationDocumentPathSchema),
    }),
  ),
  policies: Type.Optional(
    closed({
      sources: Type.Array(OrganizationDocumentPathSchema, { minItems: 1, uniqueItems: true }),
      release: Type.Optional(OrganizationDocumentPathSchema),
    }),
  ),
  vocabulary: Type.Optional(OrganizationDocumentPathSchema),
  admissions: Type.Optional(OrganizationDocumentPathSchema),
  projects: Type.Optional(UniquePaths()),
  capabilities: Type.Optional(UniquePaths()),
  instructions: Type.Optional(Type.Array(OrganizationInstructionSchema)),
  documents: Type.Optional(UniquePaths()),
  archive: Type.Optional(OrganizationDocumentPathSchema),
  releases: Type.Optional(UniquePaths()),
  deployment: Type.Optional(OrganizationDocumentPathSchema),
  source: Type.Optional(OrganizationSourceLocationSchema),
});
export type OrganizationRoot = Static<typeof OrganizationRootSchema>;

export const WorkspaceProfileSchema = closed({
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("workspace-profile"),
  id: NonEmptyString,
  profile: Type.Literal(ORGANIZATION_SOURCE_PROFILE),
  version: Type.String({ pattern: "^[1-9][0-9]*\\.[0-9]+\\.[0-9]+$" }),
  requirements: closed({
    facts: UniqueNames(),
    minimumProjects: SafeInt,
    requiredCapabilities: UniqueNames(),
    instructions: Type.Boolean(),
  }),
  allowedCapabilityOrigins: Type.Array(
    Type.Union([Type.Literal("workspace"), Type.Literal("official"), Type.Literal("curated")]),
    { uniqueItems: true },
  ),
  handling: closed({ required: Type.Boolean() }),
  readinessChecks: UniquePaths(),
});
export type WorkspaceProfile = Static<typeof WorkspaceProfileSchema>;

export const ProjectMembershipSchema = closed({
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("project-membership"),
  id: NonEmptyString,
  mode: Type.Union([Type.Literal("managed"), Type.Literal("independent")]),
  source: ProjectSourceSchema,
  role: NonEmptyString,
  contract: OrganizationDocumentPathSchema,
  handling: OrganizationDocumentPathSchema,
  state: Type.Union([Type.Literal("active"), Type.Literal("suspended"), Type.Literal("removed")]),
});
export type ProjectMembership = Static<typeof ProjectMembershipSchema>;

export const CapabilityOriginSchema = Type.Union([
  Type.Literal("workspace"),
  Type.Literal("official"),
  Type.Literal("curated"),
]);
export type CapabilityOrigin = Static<typeof CapabilityOriginSchema>;

/** `declaration` and component `reference` point to their owning existing
 * capability/Definition formats; this schema does not duplicate them. */
export const CapabilitySelectionSchema = closed({
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("capability-selection"),
  id: NonEmptyString,
  declaration: OrganizationDocumentPathSchema,
  components: Type.Array(
    closed({ id: NonEmptyString, reference: OrganizationDocumentPathSchema }),
    { uniqueItems: true },
  ),
  origin: CapabilityOriginSchema,
  dependencyLock: OrganizationDocumentPathSchema,
  requiredDispositions: UniqueNames(),
});
export type CapabilitySelection = Static<typeof CapabilitySelectionSchema>;

export const ReleaseMemberKindSchema = Type.Union([
  Type.Literal("policy"),
  Type.Literal("capability-admission"),
  Type.Literal("workflow-publication"),
  Type.Literal("contract-check"),
  Type.Literal("target-readiness"),
  Type.Literal("setup-condition"),
]);
export type ReleaseMemberKind = Static<typeof ReleaseMemberKindSchema>;

export const ReleaseDeclarationSchema = closed({
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("release-declaration"),
  name: NonEmptyString,
  selection: closed({ projects: UniqueNames(), capabilities: UniqueNames() }),
  members: Type.Array(
    closed({
      key: NonEmptyString,
      artifact: OrganizationDocumentPathSchema,
      kind: ReleaseMemberKindSchema,
      required: Type.Boolean(),
      acceptableDispositions: Type.Array(NonEmptyString, { minItems: 1, uniqueItems: true }),
    }),
  ),
  predecessors: UniqueNames(),
});
export type ReleaseDeclaration = Static<typeof ReleaseDeclarationSchema>;

export const organizationSourceV2: ProfileEntry = {
  literal: ORGANIZATION_SOURCE_PROFILE,
  rootDocument: "organization",
  documents: {
    organization: OrganizationRootSchema,
    workspaceProfile: WorkspaceProfileSchema,
    projectMembership: ProjectMembershipSchema,
    capabilitySelection: CapabilitySelectionSchema,
    releaseDeclaration: ReleaseDeclarationSchema,
  },
};
