default:
    @just --list

setup:
    corepack enable
    pnpm install

build:
    pnpm -r build

check:
    just build
    scripts/check-frozen.sh
    just gen-schemas
    # --exit-code alone passes on a schema the emitter wrote and nobody
    # committed, which is how dsg.core.identity-binding/1 first slipped
    # through: untracked is not unchanged.
    git add --intent-to-add packages/idl/schema
    git diff --exit-code packages/idl/schema
    pnpm -r check-types
    pnpm -r lint
    pnpm exec oxfmt --check .
    pnpm -r test
    just conform
    node --test scripts/release.test.mjs

test:
    pnpm -r test

lint:
    pnpm -r lint

fmt:
    pnpm exec oxfmt .

gen-schemas:
    pnpm exec tsx scripts/emit-schemas.ts
    pnpm exec oxfmt packages/idl/schema/

conform:
    pnpm exec tsx packages/idl-conformance/src/cli.ts

clean:
    rm -rf node_modules dist
    find packages -maxdepth 2 -type d \( -name node_modules -o -name dist \) -exec rm -rf {} +

# Copy the schemas and vectors into dsg-infra, the one consumer with no node
# toolchain. Every other consumer installs the published packages by version.
vendor-infra-assets *infra:
    scripts/vendor.sh {{infra}}

# Prepare both package versions. The tagged workflow owns publication.
release-version version:
    node scripts/release.mjs prepare {{quote(version)}}

# Prepare, check, merge the delivery PR, tag, and wait for verified publication.
release version:
    node scripts/release.mjs ship {{quote(version)}}
