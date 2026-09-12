# Authentication probe

Reproducible evidence for `../authentication-contract.md` and
`../auth-probe-evidence.md`.

```
npm ci
node probe.mjs
```

Node 24 and Docker. The probe starts its own PostgreSQL container
(unique name, ephemeral loopback port, image pinned by digest in `probe.mjs`),
runs every scenario against the pinned Better Auth packages over loopback, and
removes the container on exit. Set `PROBE_DATABASE_URL` to point the probe at
an already-running PostgreSQL instance instead (an isolated shared instance,
for example): Docker is then skipped entirely and nothing is started or
removed. It needs no other service and prints no secret.

RP-initiated logout verifies its own `id_token_hint` by fetching this
process's `/auth/jwks` over the network, so the probe also binds a real
HTTP listener on `127.0.0.1:3999` for the run; every other scenario still
calls the in-process handler directly.

One JSON line per scenario on stdout. `package-lock.json` carries the exact
dependency versions and integrity hashes. This directory is not part of the
published package and is not a runtime.

The age-policy scenarios demonstrate why the candidate refresh hook cannot
guarantee Workspace offboarding. They are counterexamples, not a production
policy implementation. The PKCE failure uses a fresh, unconsumed code; the
correct-verifier control and code replay are separate scenarios.
