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
branch or git ref. No consumer repo may define a `dsg.*.*/N` literal;
each consumer's CI greps its source for that pattern and fails on a hit.
