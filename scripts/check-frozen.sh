#!/usr/bin/env bash
# Rule 4, applied to what it protects: the WIRE. A released profile's
# emitted JSON Schema is frozen from the first STABLE release tag
# (major >= 1) that contains it; source refactors that provably keep the
# emitted bytes (constant hoists, comment edits) are legal, a changed
# emitted schema is not. Changes ship as /N+1 beside /1.
#
# Pre-1.0 (major 0) tags never freeze anything: a 0.x release is
# development-stage by definition, and this stack has not shipped, so no
# 0.x-tagged byte sequence is held by a deployed consumer that cannot
# re-fetch it. This is a version-gated policy applied identically to
# every schema, not a per-file exemption.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

failed=0
for file in packages/idl/schema/*.json; do
  first_tag=""
  for tag in $(git tag --list 'v*' --sort=creatordate); do
    major="${tag#v}"
    major="${major%%.*}"
    [[ "$major" =~ ^[0-9]+$ ]] || continue
    [ "$major" -lt 1 ] && continue
    if git cat-file -e "$tag:$file" 2>/dev/null; then
      first_tag="$tag"
      break
    fi
  done
  [ -z "$first_tag" ] && continue
  if ! git diff --quiet "$first_tag" HEAD -- "$file" || ! git diff --quiet HEAD -- "$file"; then
    echo "FROZEN WIRE: $file differs from its first stable release tag $first_tag; ship a /N+1 instead"
    failed=1
  fi
done
exit $failed
