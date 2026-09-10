import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACKAGES = ["idl", "idl-conformance"];
const REGISTRY = "https://registry.npmjs.org";
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const run = (command, args, cwd = ROOT) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
export const integrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

function packageInfo(root = ROOT) {
  return PACKAGES.map((directory) => ({
    directory,
    ...json(join(root, "packages", directory, "package.json")),
  }));
}

function clean(root) {
  assert.equal(run("git", ["status", "--porcelain"], root), "", "release source is dirty");
}

export function checkSource(tag, root = ROOT) {
  assert(tag?.startsWith("v") && VERSION.test(tag.slice(1)), "tag must be vMAJOR.MINOR.PATCH");
  clean(root);
  const commit = run("git", ["rev-parse", "HEAD"], root);
  assert.equal(
    run("git", ["cat-file", "-t", `refs/tags/${tag}`], root),
    "tag",
    "use an annotated tag",
  );
  assert.equal(
    run("git", ["rev-parse", `${tag}^{commit}`], root),
    commit,
    "checkout must match the tag",
  );
  run("git", ["merge-base", "--is-ancestor", commit, "origin/main"], root);
  for (const pkg of packageInfo(root)) {
    assert.equal(pkg.name, `@dynamicalsystems/${pkg.directory}`);
    assert.equal(pkg.version, tag.slice(1), `${pkg.name} version differs from the tag`);
  }
  return commit;
}

function prepare(version) {
  assert(VERSION.test(version), "version must be MAJOR.MINOR.PATCH");
  clean(ROOT);
  for (const pkg of packageInfo()) {
    const path = join(ROOT, "packages", pkg.directory, "package.json");
    const manifest = json(path);
    manifest.version = version;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log(
    `Both packages are ${version}. Run just check, commit on main, then push annotated tag v${version}.`,
  );
}

function pack(destination) {
  clean(ROOT);
  const output = resolve(destination);
  mkdirSync(output, { recursive: true });
  const packages = packageInfo();
  const version = packages[0].version;
  assert(VERSION.test(version));
  assert(
    packages.every((pkg) => pkg.version === version),
    "package versions differ",
  );
  const receipt = {
    tag: `v${version}`,
    commit: run("git", ["rev-parse", "HEAD"]),
    node: process.version,
    pnpm: run("pnpm", ["--version"]),
    packages: [],
  };
  for (const pkg of packages) {
    run("pnpm", ["pack", "--pack-destination", output], join(ROOT, "packages", pkg.directory));
    const filename = `dynamicalsystems-${pkg.directory}-${version}.tgz`;
    const path = join(output, filename);
    const packed = JSON.parse(run("tar", ["-xOf", path, "package/package.json"]));
    assert.equal(packed.name, pkg.name);
    assert.equal(packed.version, version);
    for (const value of Object.values(packed.dependencies ?? {})) {
      assert(!/^(workspace|catalog|file|link):/.test(value), "unresolved package dependency");
    }
    if (pkg.directory === "idl-conformance") {
      assert.equal(packed.dependencies["@dynamicalsystems/idl"], version);
    }
    receipt.packages.push({
      name: pkg.name,
      version,
      filename,
      integrity: integrity(readFileSync(path)),
    });
  }
  clean(ROOT);
  writeFileSync(join(output, "release-manifest.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}

export function verifyArtifacts(destination, root = ROOT) {
  const receipt = json(join(destination, "release-manifest.json"));
  assert.equal(
    receipt.commit,
    run("git", ["rev-parse", "HEAD"], root),
    "artifact source differs from checkout",
  );
  const expected = packageInfo(root);
  assert.equal(receipt.packages.length, expected.length);
  for (const [index, pkg] of receipt.packages.entries()) {
    assert.equal(pkg.name, expected[index].name);
    assert.equal(pkg.version, expected[index].version);
    assert.equal(receipt.tag, `v${pkg.version}`);
    assert.equal(pkg.filename, `dynamicalsystems-${PACKAGES[index]}-${pkg.version}.tgz`);
    assert.equal(basename(pkg.filename), pkg.filename);
    assert.equal(
      integrity(readFileSync(join(destination, pkg.filename))),
      pkg.integrity,
      `changed archive: ${pkg.name}`,
    );
  }
  return receipt;
}

export async function published(pkg) {
  const response = await fetch(`${REGISTRY}/${encodeURIComponent(pkg.name)}/${pkg.version}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { "cache-control": "no-cache" },
  });
  if (response.status === 404) return "absent";
  assert(response.ok, `registry lookup failed for ${pkg.name}: HTTP ${response.status}`);
  const metadata = await response.json();
  assert.equal(metadata.name, pkg.name);
  assert.equal(metadata.version, pkg.version);
  assert.equal(
    metadata.dist.integrity,
    pkg.integrity,
    `published bytes differ for ${pkg.name}; never reuse the version`,
  );
  const tarball = new URL(metadata.dist.tarball);
  assert.equal(tarball.origin, REGISTRY, "unexpected registry tarball origin");
  const artifact = await fetch(tarball, { signal: AbortSignal.timeout(30_000) });
  if (artifact.status === 404) return "pending";
  assert(artifact.ok, `cannot download ${pkg.name}`);
  assert.equal(
    integrity(Buffer.from(await artifact.arrayBuffer())),
    pkg.integrity,
    `downloaded bytes differ for ${pkg.name}`,
  );
  return "verified";
}

async function publish(destination) {
  const receipt = verifyArtifacts(destination);
  checkSource(receipt.tag);
  // Preflight both names before an irreversible publish, including partial reruns.
  const present = await Promise.all(receipt.packages.map(published));
  for (const [index, pkg] of receipt.packages.entries()) {
    if (present[index] === "absent") {
      execFileSync(
        "npm",
        [
          "publish",
          join(destination, pkg.filename),
          "--access",
          "public",
          "--provenance",
          "--ignore-scripts",
        ],
        {
          cwd: ROOT,
          stdio: "inherit",
        },
      );
    }
    let verified = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if ((await published(pkg)) === "verified") {
        verified = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    assert(verified, `registry did not expose ${pkg.name}@${pkg.version}; rerun the same tag`);
    console.log(`Verified ${pkg.name}@${pkg.version} ${pkg.integrity}`);
  }
  const notes = [
    `Built from [${receipt.commit}](https://github.com/DynamicalSystemsGroup/dsg-idl/commit/${receipt.commit}).`,
    "",
    "Both npm archives were downloaded and matched against these tagged-build artifacts.",
    "",
    ...receipt.packages.map(
      (pkg) => `- ${pkg.name}@${pkg.version}\n  Integrity: \`${pkg.integrity}\``,
    ),
    "",
    "The attached release-manifest.json records source, tools and package integrity.",
  ].join("\n");
  writeFileSync(join(destination, "release-notes.md"), notes);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) writeFileSync(summary, `${notes}\n`, { flag: "a" });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  try {
    assert(
      argument,
      "usage: release.mjs prepare <version> | check <tag> | pack <directory> | verify <directory> | publish <directory>",
    );
    if (command === "prepare") prepare(argument);
    else if (command === "check") console.log(checkSource(argument));
    else if (command === "pack") pack(argument);
    else if (command === "verify") console.log(JSON.stringify(verifyArtifacts(resolve(argument))));
    else if (command === "publish") await publish(resolve(argument));
    else throw new Error("unknown release command");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
