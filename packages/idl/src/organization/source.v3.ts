// dsg.organization.source/3
// Organization authoring is selection and review input only. This profile has
// no principals, grants, admissions, deployment wiring, or runtime authority.
import { type Static, Type } from "@sinclair/typebox";
import { ExtensionReleaseReferenceSchema } from "../extension/release.v1.js";
import { closed, Hex64, NonEmptyString, type ProfileEntry } from "../primitives.js";
import {
  DependencyLockSchema,
  type DependencyLock,
  OrganizationReleaseMemberKindSchema,
} from "./release.v1.js";
import {
  OrganizationDocumentPathSchema,
  OrganizationSpaceSchema,
  OrganizationSourceLocationSchema,
  ProjectSourceSchema,
} from "./source.v2.js";

export const ORGANIZATION_SOURCE_V3_PROFILE = "dsg.organization.source/3" as const;

const IdentifierSchema = Type.String({ pattern: "^[a-z][a-z0-9-]*(?:[.-][a-z0-9]+)*$" });
const UniqueIdentifiers = () => Type.Array(IdentifierSchema, { minItems: 1, uniqueItems: true });
const IdentifierSet = () => Type.Array(IdentifierSchema, { uniqueItems: true });
const UniquePaths = () => Type.Array(OrganizationDocumentPathSchema, { uniqueItems: true });
const UniqueStrings = () => Type.Array(NonEmptyString, { uniqueItems: true });

export const OrganizationSourceProjectSchema = closed({
  schemaVersion: Type.Literal(3),
  kind: Type.Literal("project-membership"),
  id: IdentifierSchema,
  source: ProjectSourceSchema,
  contract: OrganizationDocumentPathSchema,
  handling: OrganizationDocumentPathSchema,
});
export type OrganizationSourceProject = Static<typeof OrganizationSourceProjectSchema>;

export const OrganizationSelectionDispositionSchema = closed({
  kind: Type.Union([
    Type.Literal("publication"),
    Type.Literal("import"),
    Type.Literal("admission"),
    Type.Literal("target"),
    Type.Literal("check"),
    Type.Literal("setup"),
    Type.Literal("paid-execution"),
  ]),
  required: Type.Boolean(),
  acceptable: UniqueStrings(),
});
export type OrganizationSelectionDisposition = Static<
  typeof OrganizationSelectionDispositionSchema
>;

export const AuthoredOverlaySchema = closed({
  id: IdentifierSchema,
  document: OrganizationDocumentPathSchema,
  sha256: Hex64,
  mediaType: NonEmptyString,
});
export type AuthoredOverlay = Static<typeof AuthoredOverlaySchema>;

export const CapabilitySelectionV3Schema = closed({
  schemaVersion: Type.Literal(3),
  kind: Type.Literal("capability-selection"),
  id: IdentifierSchema,
  release: ExtensionReleaseReferenceSchema,
  memberIds: UniqueIdentifiers(),
  origin: Type.Union([
    Type.Literal("workspace"),
    Type.Literal("official"),
    Type.Literal("curated"),
  ]),
  dependencyLock: OrganizationDocumentPathSchema,
  requiredDispositions: Type.Array(OrganizationSelectionDispositionSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
  authoredOverlays: Type.Array(AuthoredOverlaySchema, { uniqueItems: true }),
});
export type CapabilitySelectionV3 = Static<typeof CapabilitySelectionV3Schema>;

export const WorkspaceProfileV3Schema = closed({
  schemaVersion: Type.Literal(3),
  kind: Type.Literal("workspace-profile"),
  profile: Type.Literal(ORGANIZATION_SOURCE_V3_PROFILE),
  id: IdentifierSchema,
  version: Type.String({ pattern: "^(?:0|[1-9][0-9]*)\\.[0-9]+\\.[0-9]+$" }),
  requirements: closed({
    facts: UniqueStrings(),
    minimumProjects: Type.Integer({ minimum: 0 }),
    requiredSelections: Type.Array(IdentifierSchema, { uniqueItems: true }),
    instructions: Type.Boolean(),
  }),
  allowedOrigins: Type.Array(
    Type.Union([Type.Literal("workspace"), Type.Literal("official"), Type.Literal("curated")]),
    { minItems: 1, uniqueItems: true },
  ),
  sourceChecks: UniquePaths(),
});
export type WorkspaceProfileV3 = Static<typeof WorkspaceProfileV3Schema>;

/** A semantic dependency lock is a source document referenced by the root;
 * its lock bytes contain no Build self-reference or runtime observations. */
export const OrganizationDependencyLockSchema = DependencyLockSchema;
export type OrganizationDependencyLock = DependencyLock;

export const OrganizationSourceReleaseMemberSchema = closed({
  id: IdentifierSchema,
  kind: OrganizationReleaseMemberKindSchema,
  required: Type.Boolean(),
  acceptableDispositions: Type.Array(NonEmptyString, { minItems: 1, uniqueItems: true }),
  subject: OrganizationDocumentPathSchema,
});
export type OrganizationSourceReleaseMember = Static<typeof OrganizationSourceReleaseMemberSchema>;

/** Source-only Organization Release declaration. Runtime status, admission,
 * activation, predecessor, and supersession belong to release records. */
export const OrganizationReleaseDeclarationSchema = closed({
  schemaVersion: Type.Literal(3),
  kind: Type.Literal("organization-release-declaration"),
  id: IdentifierSchema,
  dependencyLock: OrganizationDocumentPathSchema,
  selections: IdentifierSet(),
  members: Type.Array(OrganizationSourceReleaseMemberSchema, {
    minItems: 1,
    uniqueItems: true,
  }),
  acceptance: closed({
    requiredMembers: UniqueIdentifiers(),
    acceptableDispositions: Type.Array(NonEmptyString, { minItems: 1, uniqueItems: true }),
  }),
});
export type OrganizationReleaseDeclaration = Static<typeof OrganizationReleaseDeclarationSchema>;

export const OrganizationRootV3Schema = closed({
  schemaVersion: Type.Literal(3),
  kind: Type.Literal("organization"),
  org: NonEmptyString,
  space: OrganizationSpaceSchema,
  purpose: NonEmptyString,
  profile: OrganizationDocumentPathSchema,
  projects: UniquePaths(),
  capabilities: UniquePaths(),
  dependencyLocks: UniquePaths(),
  releases: UniquePaths(),
  instructions: UniquePaths(),
  documents: UniquePaths(),
  archive: Type.Optional(OrganizationDocumentPathSchema),
  source: Type.Optional(OrganizationSourceLocationSchema),
});
export type OrganizationRootV3 = Static<typeof OrganizationRootV3Schema>;

export const organizationSourceV3: ProfileEntry = {
  literal: ORGANIZATION_SOURCE_V3_PROFILE,
  rootDocument: "organization",
  documents: {
    organization: OrganizationRootV3Schema,
    profile: WorkspaceProfileV3Schema,
    project: OrganizationSourceProjectSchema,
    capabilitySelection: CapabilitySelectionV3Schema,
    dependencyLock: OrganizationDependencyLockSchema,
    releaseMember: OrganizationSourceReleaseMemberSchema,
    releaseDeclaration: OrganizationReleaseDeclarationSchema,
  },
};
