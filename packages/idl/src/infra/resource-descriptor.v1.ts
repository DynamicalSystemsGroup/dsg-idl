// dsg.infra.resource-descriptor/1
// Owner: dsg-infra (policy/resource-descriptor.schema.json is the source;
// law_contract.py validates this exact shape and evaluate_descriptor
// returns its canonical digest). A concrete provider-neutral resource: the
// thing rendered from a workload and gated against the signed law's
// capability limits before any provider API sees it. Distinct from
// signed-law's capabilityProfile, which states allowed LIMITS; this
// document states one concrete resource checked against them.
//
// The wire carries kind "dsg.infra.resource-descriptor" plus
// schemaVersion 1; the /1 literal itself is the version marker signed-law
// fields pin (scope.resourceDescriptorVersion, capabilities
// .descriptorVersion), so the constant lives here and signed-law imports
// it. Lifted verbatim from dsg-infra policy/resource-descriptor.schema.json
// at fccf709.
import { type Static, Type } from "@sinclair/typebox";
import { closed, NonEmptyString, type ProfileEntry } from "../primitives.js";

export const RESOURCE_DESCRIPTOR_PROFILE = "dsg.infra.resource-descriptor/1" as const;
/** The document kind: the profile literal without its version suffix; the
 * version rides in schemaVersion. Frozen /1 wire choice. */
export const RESOURCE_DESCRIPTOR_KIND = "dsg.infra.resource-descriptor" as const;

const prefixedDigest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });

const ResourceDescriptorSchemaValue = closed({
  schemaVersion: Type.Literal(1),
  kind: Type.Literal(RESOURCE_DESCRIPTOR_KIND),
  workloadClass: NonEmptyString,
  lifecycle: Type.Union([Type.Literal("ephemeral"), Type.Literal("durable")]),
  machineType: Type.String({ pattern: "^[a-z][a-z0-9]*-[a-z0-9]+-[0-9]+$" }),
  accelerator: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  acceleratorCount: Type.Integer({ minimum: 0 }),
  vcpuCount: Type.Integer({ minimum: 1 }),
  memoryGiB: Type.Integer({ minimum: 1 }),
  maxRunSeconds: Type.Integer({ minimum: 1 }),
  maxParallelism: Type.Integer({ minimum: 1 }),
  region: NonEmptyString,
  imageDigest: prefixedDigest,
  moduleDigest: prefixedDigest,
  externalIp: Type.Literal(false),
  network: Type.Literal("private"),
  reservation: closed({
    gpuSeconds: Type.Integer({ minimum: 0 }),
    usdMicroUnits: Type.Integer({ minimum: 0 }),
  }),
});
export const ResourceDescriptorSchema: typeof ResourceDescriptorSchemaValue =
  ResourceDescriptorSchemaValue;
export type ResourceDescriptor = Static<typeof ResourceDescriptorSchema>;

export const resourceDescriptorV1: ProfileEntry = {
  literal: RESOURCE_DESCRIPTOR_PROFILE,
  literalNote:
    "carried as kind (unversioned) plus schemaVersion on the document; the /1 literal is the version marker signed-law pins",
  rootShape: "descriptor",
  shapes: { descriptor: ResourceDescriptorSchema },
};
