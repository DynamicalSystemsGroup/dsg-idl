default:
    @just --list

setup:
    corepack enable
    pnpm install

build:
    pnpm -r build

check:
    just build
    just gen-schemas
    git diff --exit-code schema
    pnpm -r check-types
    pnpm -r lint
    oxfmt --check .
    pnpm -r test

test:
    pnpm -r test

lint:
    pnpm -r lint

fmt:
    oxfmt .

gen-schemas:
    pnpm exec tsx scripts/emit-schemas.ts
    oxfmt schema/

conform:
    pnpm exec tsx packages/idl-conformance/src/cli.ts

clean:
    rm -rf node_modules dist
    find packages -maxdepth 2 -type d \( -name node_modules -o -name dist \) -exec rm -rf {} +

# Pack idl + idl-conformance into every consumer's vendor/ and reinstall.
vendor *consumers:
    scripts/vendor.sh {{consumers}}
