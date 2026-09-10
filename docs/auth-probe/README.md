# Authentication probe

Reproducible evidence for `../authentication-contract.md` and
`../auth-probe-evidence.md`.

```
npm ci
node probe.mjs
```

Node 24 and Docker. The probe starts its own PostgreSQL container
(`dsg-auth-probe-postgres`, port 55439, image pinned by digest in `probe.mjs`),
runs every scenario against the pinned Better Auth packages over loopback, and
removes the container on exit. It needs no other service and prints no secret.

One JSON line per scenario on stdout. `package-lock.json` carries the exact
dependency versions and integrity hashes. This directory is not part of the
published package and is not a runtime.
