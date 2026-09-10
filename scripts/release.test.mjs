import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkSource, integrity, published, verifyArtifacts } from "./release.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "idl-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release-test@example.invalid");
  for (const directory of ["idl", "idl-conformance"]) {
    mkdirSync(join(root, "packages", directory), { recursive: true });
    writeFileSync(
      join(root, "packages", directory, "package.json"),
      JSON.stringify({ name: `@dynamicalsystems/${directory}`, version: "0.9.0" }),
    );
  }
  git("add", ".");
  git("commit", "-m", "Prepare test packages");
  const commit = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", commit);
  git("tag", "-a", "v0.9.0", "-m", "Test release");
  return { root, git, commit };
}

test("release requires matching versions, a clean tree and an annotated main commit", (t) => {
  const { root, git, commit } = fixture(t);
  assert.equal(checkSource("v0.9.0", root), commit);
  assert.throws(() => checkSource("0.9.0", root), /tag must/);
  git("tag", "v0.10.0");
  assert.throws(() => checkSource("v0.10.0", root), /annotated tag/);
  git("tag", "-a", "v0.11.0", "-m", "Wrong version");
  assert.throws(() => checkSource("v0.11.0", root), /version differs/);
  writeFileSync(join(root, "uncommitted.txt"), "not in the tag");
  assert.throws(() => checkSource("v0.9.0", root), /dirty/);
  git("add", ".");
  git("commit", "-m", "Unmerged change");
  git("tag", "-a", "v0.12.0", "-m", "Unmerged release");
  assert.throws(() => checkSource("v0.12.0", root));
});

test("artifact verification catches changed bytes and the wrong source", (t) => {
  const { root, commit } = fixture(t);
  const output = mkdtempSync(join(tmpdir(), "idl-archives-"));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const packages = ["idl", "idl-conformance"].map((directory) => {
    const filename = `dynamicalsystems-${directory}-0.9.0.tgz`;
    const bytes = Buffer.from(`archive for ${directory}`);
    writeFileSync(join(output, filename), bytes);
    return {
      name: `@dynamicalsystems/${directory}`,
      version: "0.9.0",
      filename,
      integrity: integrity(bytes),
    };
  });
  const receipt = { tag: "v0.9.0", commit, packages };
  const manifest = join(output, "release-manifest.json");
  writeFileSync(manifest, JSON.stringify(receipt));
  assert.deepEqual(verifyArtifacts(output, root), receipt);
  const archive = join(output, packages[1].filename);
  const original = readFileSync(archive);
  writeFileSync(archive, Buffer.concat([original, Buffer.from("mutation")]));
  assert.throws(() => verifyArtifacts(output, root), /changed archive/);
  writeFileSync(archive, original);
  receipt.commit = "0".repeat(40);
  writeFileSync(manifest, JSON.stringify(receipt));
  assert.throws(() => verifyArtifacts(output, root), /artifact source/);
});

test("registry visibility waits for the archive but refuses changed bytes", async (t) => {
  const pkg = {
    name: "@dynamicalsystems/idl",
    version: "0.9.0",
    integrity:
      "sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==",
  };
  const metadata = {
    ...pkg,
    dist: {
      integrity: pkg.integrity,
      tarball: "https://registry.npmjs.org/idl.tgz",
    },
  };
  let visible = false;
  let bytes = "abc";
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).endsWith(".tgz")
      ? new Response(visible ? bytes : null, { status: visible ? 200 : 404 })
      : Response.json(metadata),
  );
  assert.equal(await published(pkg), "pending");
  visible = true;
  assert.equal(await published(pkg), "verified");
  bytes = "changed";
  await assert.rejects(published(pkg), /downloaded bytes differ/);
});
