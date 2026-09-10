# dsg-idl

The one place every DSG governed compute plane wire profile is defined,
versioned, and proven. Every repo that speaks a `dsg.<domain>.<name>/N`
shape imports it from here by digest. Nothing is hand-transcribed.

Packages:

- `@dynamicalsystems/idl`: profile literals, TypeBox schemas, Static
  types, shared primitives. The only executable code is schema
  construction; no I/O, no transport, no canonicalization.
- `@dynamicalsystems/idl-conformance`: accept/reject/digest vectors per
  profile and the runner that drives them through an adapter. A consumer
  implements the adapter over its real boundary parser. A fake of a
  counterpart replays accept vectors; it is never written by hand.

Rules, enforced by this repo's own tests and `just check`:

1. Every object is closed. An extra field is a different protocol.
2. Every profile carries its literal on at least one shape.
3. Digests are lowercase sha256 hex. Timestamps are exact UTC seconds.
   No profile defines its own primitive.
4. A released `/N` WIRE is frozen: the emitted JSON Schema may never
   change after its first release tag (scripts/check-frozen.sh). Source
   refactors that keep the emitted bytes are legal. Changes ship as
   `/N+1` beside `/1`.
5. A profile with no vectors does not build.
6. `schema/` is generated JSON Schema, committed, checked fresh. Non-TS
   consumers read it and never hold their own copy.

Consumers pin a release tarball by URL and lockfile integrity, never a
branch or git ref.

Documents:

- [Tagged releases](RELEASES.md): prepare a version, push an annotated tag, and
  let the workflow publish both packages with verified archive provenance.

- [Shared authentication contract](docs/authentication-contract.md): the
  normative Better Auth authority, token-class revocation, per-hop credential
  transport, validation, identity mapping, client lifecycle, human
  confirmation, frozen-profile compatibility, errors, and migration inventory.
- [Probe evidence](docs/auth-probe-evidence.md): what the runnable probe
  observed and what remains documentation-derived. Reproduce with
  `cd docs/auth-probe && npm ci && node probe.mjs`. No consumer repo may define a `dsg.*.*/N` literal;
  each consumer's CI greps its source for that pattern and fails on a hit.

## Reproducible event stream seals

The `dsg.run.event_1/digest/streamSeal-*.json` vectors contain base64 of actual
UTF-8 `DSGEV ` event lines. Envelope and payload keys are deliberately unsorted.
The short clean stream includes `1e-7` and `café`; the second stream has a
sequence gap. Their `sha256` values were computed with the published
`dsg-run-events==0.1.1` Python package, not the TypeScript reference adapter.
The published wheel SHA-256 is
`ff9b688cba9c4b4a1448dfea3c6a265b58e8c425a011902baa986af70acc70ef`.

A consumer's `dsg.run.event/1#digest.streamSeal` adapter must parse the input
lines with its real event path, order unique events by sequence, and return
SHA-256 of RFC 8785 event bytes joined with LF, without prefixes or a final LF.
This hashes the stream, not the seal document. The plane must reproduce these
values through its own ingestion and sealing code after its canonicalization
fix merges. Hashing payload objects in input key order fails these vectors.

The older `accept/streamSeal-*.json` documents check shape only. Their repeated
`b` digest has no corresponding source stream. A vector with a placeholder
digest cannot fail on incorrect hashing and is not a stream-seal conformance
vector. It must not be cited as evidence of digest agreement.
