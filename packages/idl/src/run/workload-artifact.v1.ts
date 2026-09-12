// dsg.run.workload-artifact/1
// This document's Reference pins JCS metadata, not executable OCI bytes.
import { type Static, Type } from "@sinclair/typebox";
import {
  closed,
  Hex64,
  NonEmptyString,
  Reference,
  UtcSecond,
  type ProfileEntry,
} from "../primitives.js";

export const WORKLOAD_ARTIFACT_PROFILE = "dsg.run.workload-artifact/1" as const;
const OciRepository = Type.String({
  pattern:
    "^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$",
});
export const WorkloadSourceSchema = closed({
  repository: NonEmptyString,
  revision: Type.String({ pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" }),
  sourceDigest: Hex64,
});
export type WorkloadSource = Static<typeof WorkloadSourceSchema>;
export const OciPlatformSchema = closed({
  os: NonEmptyString,
  architecture: NonEmptyString,
  variant: Type.Optional(NonEmptyString),
});
export type OciPlatform = Static<typeof OciPlatformSchema>;
export const WorkloadArtifactSchema = closed({
  profile: Type.Literal(WORKLOAD_ARTIFACT_PROFILE),
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("workload-artifact"),
  id: NonEmptyString,
  format: Type.Literal("oci-image"),
  source: WorkloadSourceSchema,
  index: Type.Union([
    Type.Null(),
    closed({
      sha256: Hex64,
      mediaType: Type.Union([
        Type.Literal("application/vnd.oci.image.index.v1+json"),
        Type.Literal("application/vnd.docker.distribution.manifest.list.v2+json"),
      ]),
    }),
  ]),
  executable: closed({
    repository: OciRepository,
    platform: OciPlatformSchema,
    manifest: closed({
      sha256: Hex64,
      mediaType: Type.Union([
        Type.Literal("application/vnd.oci.image.manifest.v1+json"),
        Type.Literal("application/vnd.docker.distribution.manifest.v2+json"),
      ]),
    }),
    config: closed({
      sha256: Hex64,
      mediaType: Type.Union([
        Type.Literal("application/vnd.oci.image.config.v1+json"),
        Type.Literal("application/vnd.docker.container.image.v1+json"),
      ]),
    }),
  }),
  entrypoint: Type.Array(NonEmptyString, { minItems: 1 }),
});
export type WorkloadArtifact = Static<typeof WorkloadArtifactSchema>;
// Build and transport observations bind the metadata after it has an identity;
// including this observation inside the metadata would create a digest cycle.
export const WorkloadArtifactProvenanceSchema = closed({
  profile: Type.Literal(WORKLOAD_ARTIFACT_PROFILE),
  schemaVersion: Type.Literal(1),
  kind: Type.Literal("workload-artifact-provenance"),
  artifact: Reference,
  source: WorkloadSourceSchema,
  build: Reference,
  transportArchiveSha256: Hex64,
  observedAt: UtcSecond,
  evidence: Type.Array(Reference, { minItems: 1, uniqueItems: true }),
});
export type WorkloadArtifactProvenance = Static<typeof WorkloadArtifactProvenanceSchema>;
export const workloadArtifactV1: ProfileEntry = {
  literal: WORKLOAD_ARTIFACT_PROFILE,
  rootDocument: "workloadArtifact",
  documents: {
    workloadArtifact: WorkloadArtifactSchema,
    provenance: WorkloadArtifactProvenanceSchema,
  },
};
