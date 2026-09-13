import { createHash, createPublicKey, verify } from "node:crypto";
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
  ExecutionRequestEnvelopeSchema,
  ExtensionReleaseSignatureSchema,
  DispatchLeaseSchema,
  AcceptedSchema,
  UtcSecond,
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
const ExecutionIdentityContext = ExecutionRequestEnvelopeSchema;
const ExecutionAuthorizationContext = closed({
  request: ExecutionRequestEnvelopeSchema,
  lease: DispatchLeaseSchema,
  accepted: AcceptedSchema,
  checkedAt: UtcSecond,
});
const ReleaseSignatureContext = closed({
  release: ExtensionReleaseSchema,
  signature: ExtensionReleaseSignatureSchema,
});
const OrganizationBuildContext = closed({
  build: OrganizationBuildSchema,
  dependencyLock: DependencyLockSchema,
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
        try {
          const publicKey = createPublicKey({
            key: Buffer.concat([
              Buffer.from("302a300506032b6570032100", "hex"),
              Buffer.from(signature.publicKey, "hex"),
            ]),
            format: "der",
            type: "spki",
          });
          if (
            !verify(
              null,
              Buffer.from(jcsStringify(release), "utf8"),
              publicKey,
              Buffer.from(signature.signature, "hex"),
            )
          )
            return "invalid-release-signature";
        } catch {
          return "invalid-release-signature";
        }
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
      const orderedBy = <T>(values: readonly T[], key: (value: T) => string): boolean =>
        ordered(values.map(key));
      if (!orderedBy(build.sourceDocuments, (document) => document.path))
        return "unsorted-source-closure";
      if (
        !orderedBy(build.projects, (project) => project.id) ||
        !orderedBy(build.selections, (selection) => selection.id) ||
        build.selections.some(
          (selection) => !orderedBy(selection.members, (member) => member.id),
        ) ||
        !orderedBy(build.components, (component) =>
          [
            component.extensionRelease.orn,
            component.extensionRelease.sha256,
            component.memberId,
          ].join("\0"),
        ) ||
        !orderedBy(build.typedReleases, (release) => release.id) ||
        !orderedBy(build.instructions, (reference) => `${reference.orn}\0${reference.sha256}`) ||
        !orderedBy(build.handling, (reference) => `${reference.orn}\0${reference.sha256}`) ||
        !orderedBy(
          build.releaseDeclarations,
          (reference) => `${reference.orn}\0${reference.sha256}`,
        ) ||
        !orderedBy(build.releaseMembers, (member) => member.id)
      )
        return "unsorted-build";
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
    "dsg.organization.release/1#semantic.organizationBuild": parse(
      OrganizationBuildContext,
      ({ build, dependencyLock }) => {
        if (build.dependencyLock.sha256 !== digest(dependencyLock))
          return "dependency-lock-digest-mismatch";
        if (jcsStringify(build.typedReleases) !== jcsStringify(dependencyLock.entries))
          return "typed-release-lock-mismatch";
        return;
      },
    ),
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
    "dsg.run.execution-binding/1#semantic.executionAuthorization": parse(
      ExecutionAuthorizationContext,
      ({ request, lease, accepted, checkedAt }) => {
        if (accepted.generation !== request.operation.expectedGeneration + 1)
          return "accepted-generation-mismatch";
        if (accepted.operationId !== request.operation.operationId)
          return "accepted-operation-mismatch";
        if (accepted.planDigest !== request.operation.planDigest) return "accepted-plan-mismatch";
        const { operation, binding } = request;
        if (!same(binding.reservation, operation.reservation))
          return "binding-reservation-mismatch";
        if (lease.operationId !== operation.operationId) return "lease-operation-mismatch";
        if (lease.generation !== accepted.generation) return "lease-generation-mismatch";
        if (lease.caseOrn !== operation.case.orn) return "lease-case-mismatch";
        if (lease.envelopeSha256 !== digest(operation)) return "lease-envelope-mismatch";
        if (lease.lawSha256 !== operation.document.law.bundle.sha256) return "lease-law-mismatch";
        if (!same(lease.reservation, binding.reservation)) return "lease-reservation-mismatch";
        if (Date.parse(lease.expiresAt) <= Date.parse(lease.consumedAt))
          return "invalid-dispatch-lease-window";
        if (Date.parse(checkedAt) >= Date.parse(lease.expiresAt)) return "expired-dispatch-lease";
        return;
      },
    ),
    "dsg.run.execution-binding/1#semantic.executionIdentity": parse(
      ExecutionIdentityContext,
      ({
        binding,
        operation,
        jobClass,
        workloadArtifact: artifact,
        workloadArtifactProvenance: provenance,
        admission,
        activeSet,
        releaseEligibility,
        selection,
        catalogEntry,
      }) => {
        if (releaseEligibility.operation !== "execute") return "eligibility-operation-mismatch";
        if (releaseEligibility.observation.status === "revoked") return "release-revoked";
        if (!same(releaseEligibility.observation.subject, releaseEligibility.release))
          return "eligibility-subject-mismatch";
        if (!same(releaseEligibility.observation.trustView, releaseEligibility.trustView))
          return "eligibility-observation-trust-mismatch";
        if (
          releaseEligibility.observation.status === "retired" &&
          (releaseEligibility.operation !== "execute" ||
            releaseEligibility.activeSet === null ||
            !same(releaseEligibility.activeSet, binding.activeSet))
        )
          return "release-retired";
        if (binding.selection.sha256 !== digest(selection)) return "selection-digest-mismatch";
        if (selection.id !== catalogEntry.selectionId || selection.id !== admission.selectionId)
          return "selection-id-mismatch";
        if (
          !same(selection.extensionRelease, binding.extensionRelease) ||
          !same(catalogEntry.extensionRelease, binding.extensionRelease)
        )
          return "selection-release-mismatch";
        if (catalogEntry.availability !== "available") return "catalog-entry-unavailable";
        if (
          !same(catalogEntry.activeSet, binding.activeSet) ||
          !same(catalogEntry.workflow, binding.workflow) ||
          catalogEntry.jobClass === null ||
          !same(catalogEntry.jobClass, binding.jobClass) ||
          catalogEntry.workloadArtifact === null ||
          !same(catalogEntry.workloadArtifact, binding.workloadArtifact)
        )
          return "catalog-binding-mismatch";
        if (!same(releaseEligibility.release, binding.extensionRelease))
          return "eligibility-release-mismatch";
        if (!same(releaseEligibility.trustView, binding.trustView))
          return "eligibility-trust-view-mismatch";
        if (
          releaseEligibility.activeSet === null ||
          !same(releaseEligibility.activeSet, binding.activeSet)
        )
          return "eligibility-active-set-mismatch";
        if (admission.status !== "admitted") return "admission-refused";
        if (
          !admission.approvedUses.some(
            (approved) => approved.use === "execute" && same(approved.binding, binding.jobClass),
          )
        )
          return "execution-use-not-approved";
        if (operation.document.resources.maxRunSeconds > jobClass.bounds.maxRunSeconds)
          return "run-seconds-exceed-class";
        if (operation.document.resources.maxGpuSeconds > jobClass.bounds.maxGpuSeconds)
          return "gpu-seconds-exceed-class";
        if (operation.document.resources.maxParallelism > jobClass.bounds.maxParallelism)
          return "parallelism-exceeds-class";
        if (binding.admission.sha256 !== digest(admission)) return "admission-digest-mismatch";
        if (binding.activeSet.sha256 !== digest(activeSet)) return "active-set-digest-mismatch";
        if (
          binding.installation !== admission.installation ||
          binding.installation !== activeSet.installation
        )
          return "installation-mismatch";
        if (
          !same(binding.organizationBuild, admission.build) ||
          !same(binding.organizationBuild, activeSet.build)
        )
          return "organization-build-mismatch";
        if (
          !same(binding.organizationRelease, admission.release) ||
          !same(binding.organizationRelease, activeSet.release)
        )
          return "organization-release-mismatch";
        if (!same(binding.extensionRelease, admission.extensionRelease))
          return "admission-release-mismatch";
        const activeMember = activeSet.members.find(
          (member) =>
            same(member.admission, binding.admission) &&
            same(member.extensionRelease, binding.extensionRelease),
        );
        if (!activeMember) return "release-not-active";
        if (
          activeMember.selectionId !== selection.id ||
          activeMember.memberId !== catalogEntry.memberId
        )
          return "active-member-identity-mismatch";
        const selectedComponents = selection.members.map((component) => component.reference);
        const activeComponents = activeMember.components.map((component) => component.reference);
        const admittedComponents = admission.components.map((component) => component.reference);
        for (const required of [
          binding.workflow,
          binding.jobClass,
          binding.workloadArtifact,
          binding.eventCatalog,
        ]) {
          if (!selectedComponents.some((component) => same(component, required)))
            return "selected-component-mismatch";
          if (!activeComponents.some((component) => same(component, required)))
            return "active-component-mismatch";
          if (!admittedComponents.some((component) => same(component, required)))
            return "admitted-component-mismatch";
        }
        if (binding.operation.sha256 !== digest(operation)) return "operation-digest-mismatch";
        if (!same(binding.target, operation.document.placement)) return "operation-target-mismatch";
        if (!same(binding.jobClass, operation.document.classContract))
          return "operation-job-class-mismatch";
        if (!same(binding.workloadArtifact, operation.document.workload))
          return "operation-workload-mismatch";
        if (!same(binding.law, operation.document.law.bundle)) return "operation-law-mismatch";
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
