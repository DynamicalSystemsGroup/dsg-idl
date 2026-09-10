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
removes the container on exit. It needs no other service and prints no secret.

One JSON line per scenario on stdout. `package-lock.json` carries the exact
dependency versions and integrity hashes. This directory is not part of the
published package and is not a runtime.

The age-policy scenarios demonstrate why the candidate refresh hook cannot
guarantee Workspace offboarding. They are counterexamples, not a production
policy implementation. The PKCE failure uses a fresh, unconsumed code; the
correct-verifier control and code replay are separate scenarios.
