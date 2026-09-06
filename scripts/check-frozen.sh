#!/usr/bin/env bash
# Rule 4, applied to what it protects: the WIRE. A released profile's
# emitted JSON Schema is frozen from the first release tag that contains
# it; source refactors that provably keep the emitted bytes (constant
# hoists, comment edits) are legal, a changed emitted schema is not.
# Changes ship as /N+1 beside /1.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

failed=0
for file in packages/idl/schema/*.json; do
  first_tag=""
  for tag in $(git tag --list 'v*' --sort=creatordate); do
    if git cat-file -e "$tag:$file" 2>/dev/null; then
      first_tag="$tag"
      break
    fi
  done
  [ -z "$first_tag" ] && continue
  if ! git diff --quiet "$first_tag" HEAD -- "$file" || ! git diff --quiet HEAD -- "$file"; then
    echo "FROZEN WIRE: $file differs from its first release tag $first_tag; ship a /N+1 instead"
    failed=1
  fi
done
exit $failed
