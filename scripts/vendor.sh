#!/usr/bin/env bash
# Refresh the one consumer that cannot install a package: dsg-infra has no
# node toolchain, so it reads the generated schemas and the conformance
# vectors as plain files, with SOURCE-COMMIT naming exactly what it got.
#
#   just vendor
#
# This script used to pack tarballs into dsg-kernel, dsg-run and the module
# registry as well, and force a reinstall in each. Those consumers now install
# @dynamicalsystems/idl and @dynamicalsystems/idl-conformance from the registry
# by version, which is what makes a wire change reviewable. Running the old
# behaviour once would recreate the deleted tarballs and pull those repos back
# off the registry, so that half is gone rather than kept for convenience.
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA="${1:-$HERE/../dsg-infra}"

if [ ! -d "$INFRA" ]; then
  echo "no dsg-infra checkout at $INFRA" >&2
  exit 1
fi

mkdir -p "$INFRA/vendor/idl"
rm -rf "$INFRA/vendor/idl"/*
cp -R "$HERE/packages/idl-conformance/assets/vectors" "$INFRA/vendor/idl/vectors"
cp "$HERE/packages/idl-conformance/checklist.json" "$INFRA/vendor/idl/checklist.json"
cp -R "$HERE/packages/idl/schema" "$INFRA/vendor/idl/schema"
{ cd "$HERE" && git rev-parse HEAD; } > "$INFRA/vendor/idl/SOURCE-COMMIT"
echo "vendored assets -> $INFRA/vendor/idl"
echo "dsg-infra's conformance runner must pass on the new corpus before this is believable:"
echo "  (cd $INFRA && python3 scripts/idl-conformance.py)"
