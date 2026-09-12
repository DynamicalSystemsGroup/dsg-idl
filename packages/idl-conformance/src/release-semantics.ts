import { createHash } from "node:crypto";
import { type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { jcsStringify } from "@dynamicalsystems/orn-schemas";
import {
  closed,
  Reference,
  DependencyLockSchema,
  ExtensionReleaseSchema,
  OrganizationBuildSchema,
  OrganizationReleaseSchema,
  AdmissionRecordSchema,
  ActiveSetSchema,
  CatalogSchema,
  ReleaseEligibilitySchema,
  ExecutionBindingSchema,
  JobClassSchema,
  WorkloadArtifactSchema,
  WorkloadArtifactProvenanceSchema,
  ExtensionReleaseSignatureSchema,
} from "@dynamicalsystems/idl";
import type { Adapter, ParseResult } from "./adapter.js";

function digest<T extends object>(value: T): string {
  return createHash("sha256").update(jcsStringify(value)).digest("hex");
}
function same(a: Static<typeof Reference>, b: Static<typeof Reference>): boolean {
  return a.orn === b.orn && a.sha256 === b.sha256;
}
function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
function ordered(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}
function graphError(
  entries: readonly { id: string; dependsOn: string[] }[],
  roots: readonly string[],
): string | undefined {
  if (!unique(entries.map((entry) => entry.id))) return "duplicate-member-id";
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): string | undefined {
    if (visiting.has(id)) return "dependency-cycle";
    if (visited.has(id)) return;
    const entry = byId.get(id);
    if (!entry) return "unresolved-dependency";
    visiting.add(id);
    for (const dependency of entry.dependsOn) {
      const error = visit(dependency);
      if (error) return error;
    }
    visiting.delete(id);
    visited.add(id);
    return;
  }
  for (const root of roots) {
    const error = visit(root);
    if (error) return error;
  }
  return visited.size === entries.length ? undefined : "extraneous-lock-entry";
}
function parse<T extends TSchema>(
  schema: T,
  refine: (value: Static<T>) => string | undefined,
): (bytes: Uint8Array) => ParseResult {
  return (bytes) => {
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      return { ok: false, reason: `not UTF-8 JSON: ${String(error)}` };
    }
    if (!Value.Check(schema, value)) {
      const error = Value.Errors(schema, value).First();
      return { ok: false, reason: `${error?.path ?? ""}: ${error?.message ?? "schema mismatch"}` };
    }
    const error = refine(value);
    return error ? { ok: false, reason: error } : { ok: true };
  };
}

// These contexts are vector inputs, not new authority records or provider APIs.
// Consumers run them against their real verifier through the semantic adapter.
const ExecutionIdentityContext = closed({
  binding: ExecutionBindingSchema,
  jobClass: JobClassSchema,
  artifact: WorkloadArtifactSchema,
  provenance: WorkloadArtifactProvenanceSchema,
});
const ReleaseSignatureContext = closed({
  release: ExtensionReleaseSchema,
  signature: ExtensionReleaseSignatureSchema,
});
const ReleaseEligibilityContext = closed({
  eligibility: ReleaseEligibilitySchema,
  currentActiveSet: Reference,
  activeSet: ActiveSetSchema,
});

export function releaseSemanticAdapters(): Adapter {
  return {
    "dsg.organization.release/1#dependencyLock": parse(DependencyLockSchema, (lock) => {
      if (!ordered(lock.roots) || !ordered(lock.entries.map((entry) => entry.id)))
        return "unsorted-lock";
      for (const entry of lock.entries) {
        if (!ordered(entry.dependsOn) || !ordered(entry.selectedMemberIds)) return "unsorted-lock";
        if (
          entry.kind === "extension-release" &&
          !entry.reference.orn.startsWith("orn:dsg.core.extension.release:")
        )
          return "wrong-release-space";
        if (
          entry.kind === "workload-artifact" &&
          !entry.reference.orn.startsWith("orn:dsg.core.extension.workload-artifact:")
        )
          return "wrong-artifact-space";
      }
      return graphError(lock.entries, lock.roots);
    }),
    "dsg.extension.release/1#semantic.signatureBinding": parse(
      ReleaseSignatureContext,
      ({ release, signature }) => {
        const bodySha256 = digest(release);
        if (signature.bodySha256 !== bodySha256 || signature.release.sha256 !== bodySha256)
          return "signature-body-digest-mismatch";
        if (
          signature.release.orn !== release.releaseOrn ||
          signature.publisher !== release.publisher
        )
          return "signature-identity-mismatch";
        return;
      },
    ),
    "dsg.extension.release/1#release": parse(ExtensionReleaseSchema, (release) => {
      if (
        release.releaseOrn !==
        `orn:dsg.core.extension.release:${release.namespace}/${release.name}@${release.version}`
      )
        return "release-name-mismatch";
      if (!unique(release.dependencies.map((dependency) => dependency.id)))
        return "duplicate-dependency-id";
      const error = graphError(
        release.components,
        release.components.map((component) => component.id),
      );
      if (error) return error;
      const kinds = new Set(release.components.map((component) => component.kind));
      if (release.compute && (!kinds.has("job-class") || !kinds.has("workload-artifact")))
        return "missing-compute-component";
      for (const component of release.components) {
        if (
          component.kind === "workload-artifact" &&
          !component.reference.orn.startsWith("orn:dsg.core.extension.workload-artifact:")
        )
          return "wrong-artifact-space";
      }
      return;
    }),
    "dsg.organization.release/1#organizationBuild": parse(OrganizationBuildSchema, (build) => {
      if (!ordered(build.sourceDocuments.map((document) => document.path)))
        return "unsorted-source-closure";
      if (
        !unique(build.projects.map((project) => project.id)) ||
        !unique(build.selections.map((selection) => selection.id)) ||
        !unique(build.releaseMembers.map((member) => member.id))
      )
        return "duplicate-member-id";
      const components = new Map<string, (typeof build.components)[number]>();
      for (const component of build.components) {
        const key = `${component.extensionRelease.orn}\0${component.extensionRelease.sha256}\0${component.memberId}`;
        if (components.has(key)) return "duplicate-component-id";
        components.set(key, component);
      }
      for (const selection of build.selections) {
        if (!unique(selection.members.map((member) => member.id))) return "duplicate-member-id";
        for (const member of selection.members) {
          const component = components.get(
            `${selection.extensionRelease.orn}\0${selection.extensionRelease.sha256}\0${member.id}`,
          );
          if (
            !component ||
            component.kind !== member.kind ||
            !same(component.reference, member.reference)
          )
            return "selected-component-mismatch";
        }
      }
      return;
    }),
    "dsg.organization.release/1#organizationRelease": parse(OrganizationReleaseSchema, (release) =>
      unique(release.members.map((member) => member.id)) ? undefined : "duplicate-member-id",
    ),
    "dsg.organization.release/1#admissionRecord": parse(AdmissionRecordSchema, (admission) => {
      if (!unique(admission.components.map((component) => component.id)))
        return "duplicate-member-id";
      if (admission.status === "admitted" && !unique(admission.approvedUses.map((use) => use.use)))
        return "duplicate-approved-use";
      return;
    }),
    "dsg.organization.release/1#activeSet": parse(ActiveSetSchema, (activeSet) => {
      if (!unique(activeSet.members.map((member) => `${member.selectionId}\0${member.memberId}`)))
        return "duplicate-active-member";
      for (const member of activeSet.members) {
        if (!unique(member.components.map((component) => component.id)))
          return "duplicate-member-id";
      }
      return;
    }),
    "dsg.organization.release/1#catalog": parse(CatalogSchema, (catalog) => {
      if (!unique(catalog.entries.map((entry) => entry.id))) return "duplicate-catalog-entry";
      for (const entry of catalog.entries) {
        if (!same(entry.activeSet, catalog.activeSet)) return "catalog-active-set-mismatch";
        if ((entry.jobClass === null) !== (entry.workloadArtifact === null))
          return "incomplete-compute-provenance";
      }
      return;
    }),
    "dsg.organization.release/1#releaseEligibility": parse(
      ReleaseEligibilitySchema,
      (eligibility) => {
        if (!same(eligibility.release, eligibility.observation.subject))
          return "status-subject-mismatch";
        if (!same(eligibility.trustView, eligibility.observation.trustView))
          return "stale-trust-view";
        if (eligibility.observation.status === "revoked") return "release-revoked";
        if (
          eligibility.observation.status === "retired" &&
          (eligibility.operation !== "execute" || eligibility.activeSet === null)
        )
          return "release-retired";
        return;
      },
    ),
    "dsg.organization.release/1#semantic.releaseEligibility": parse(
      ReleaseEligibilityContext,
      ({ eligibility, currentActiveSet, activeSet }) => {
        if (!same(eligibility.release, eligibility.observation.subject))
          return "status-subject-mismatch";
        if (!same(eligibility.trustView, eligibility.observation.trustView))
          return "stale-trust-view";
        if (eligibility.observation.status === "revoked") return "release-revoked";
        if (eligibility.observation.status !== "retired") return;
        if (eligibility.operation !== "execute" || eligibility.activeSet === null)
          return "release-retired";
        if (
          !same(eligibility.activeSet, currentActiveSet) ||
          currentActiveSet.sha256 !== digest(activeSet)
        )
          return "inactive-set";
        if (!activeSet.members.some((member) => same(member.extensionRelease, eligibility.release)))
          return "release-not-active";
        return;
      },
    ),
    "dsg.run.execution-binding/1#semantic.executionIdentity": parse(
      ExecutionIdentityContext,
      ({ binding, jobClass, artifact, provenance }) => {
        if (binding.workloadArtifact.sha256 !== digest(artifact))
          return "artifact-metadata-digest-mismatch";
        if (binding.jobClass.sha256 !== digest(jobClass)) return "job-class-digest-mismatch";
        if (!same(jobClass.workloadArtifact, binding.workloadArtifact))
          return "job-class-artifact-mismatch";
        if (!same(jobClass.eventCatalog, binding.eventCatalog)) return "event-catalog-mismatch";
        if (!same(provenance.artifact, binding.workloadArtifact))
          return "provenance-subject-mismatch";
        if (jcsStringify(provenance.source) !== jcsStringify(artifact.source))
          return "source-provenance-mismatch";
        if (binding.executableManifestSha256 !== artifact.executable.manifest.sha256)
          return "wrong-executable-digest-role";
        if (
          artifact.executable.platform.os !== "linux" ||
          artifact.executable.platform.architecture !== "amd64"
        )
          return "unsupported-executable-platform";
        if (
          !jobClass.platforms.includes(
            `${artifact.executable.platform.os}/${artifact.executable.platform.architecture}`,
          )
        )
          return "job-class-platform-mismatch";
        return;
      },
    ),
  };
}
