#!/usr/bin/env bash
# Pack both packages and refresh every consumer's vendor/ in one command:
#   just vendor            all default consumers
#   just vendor ../dsg-run one consumer
# Tarballs land under STABLE names (no version suffix) so consumer pins
# never chase a filename; the lockfile hash is the version truth.
set -Eeuo pipefail
export PATH="$HOME/.local/share/mise/shims:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

consumers=("$@")
if [ "${#consumers[@]}" -eq 0 ]; then
  consumers=("$HERE/../dsg-kernel" "$HERE/../dsg-run")
fi

for repo in "${consumers[@]}"; do
  mkdir -p "$repo/vendor"
  rm -f "$repo"/vendor/dynamicalsystems-idl*.tgz
  for pkg in idl idl-conformance; do
    out="$(cd "$HERE/packages/$pkg" && pnpm pack --pack-destination "$repo/vendor" | tail -1)"
    mv "$out" "$repo/vendor/dynamicalsystems-$pkg.tgz"
  done
  cp "$HERE"/vendor/dynamicalsystems-orn-schemas-*.tgz "$repo/vendor/dynamicalsystems-orn-schemas.tgz"
  (cd "$repo" && pnpm install --force >/dev/null)
  echo "vendored -> $repo"
done
