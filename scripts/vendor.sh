#!/usr/bin/env bash
# Pack both packages and refresh every consumer's vendor/ in one command:
#   just vendor            all default consumers
#   just vendor ../dsg-run one consumer
set -Eeuo pipefail
export PATH="$HOME/.local/share/mise/shims:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

consumers=("$@")
if [ "${#consumers[@]}" -eq 0 ]; then
  consumers=("$HERE/../dsg-kernel" "$HERE/../dsg-run")
fi

for repo in "${consumers[@]}"; do
  mkdir -p "$repo/vendor"
  rm -f "$repo"/vendor/dynamicalsystems-idl-*.tgz
  for pkg in idl idl-conformance; do
    (cd "$HERE/packages/$pkg" && pnpm pack --pack-destination "$repo/vendor" >/dev/null)
  done
  cp "$HERE"/vendor/dynamicalsystems-orn-schemas-*.tgz "$repo/vendor/"
  (cd "$repo" && pnpm install --force >/dev/null)
  echo "vendored -> $repo"
done
