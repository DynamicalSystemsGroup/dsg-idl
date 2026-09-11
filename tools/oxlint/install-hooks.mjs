import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const toolRoot = fileURLToPath(new URL(".", import.meta.url));
const repository = resolve(toolRoot, "../..");
const hook = execFileSync(
  "git",
  ["rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-commit"],
  { cwd: repository, encoding: "utf8" },
).trim();
const previous = existsSync(hook) ? readFileSync(hook, "utf8") : "#!/bin/sh\n";
if (
  !previous.startsWith("#!/bin/sh\n") &&
  !previous.startsWith("#!/usr/bin/env sh\n") &&
  !previous.startsWith("#!/usr/bin/env bash\n") &&
  !previous.startsWith("#!/bin/bash\n")
) {
  throw new Error(
    "The existing pre-commit hook is not a shell script. Chain tools/oxlint/pre-commit explicitly.",
  );
}
const lines = previous.split("\n").filter((line) => !line.endsWith("# repository-anti-slop"));
const script = join(toolRoot, "pre-commit").replaceAll("'", "'\"'\"'");
lines.splice(1, 0, `sh '${script}' "$@" || exit $? # repository-anti-slop`);
writeFileSync(hook, lines.join("\n"));
chmodSync(hook, 0o755);
process.stdout.write(`Installed anti-slop in ${hook}\n`);
