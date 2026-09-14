# Change request: governance identifiers on the refusal profile

Written 2026-09-13 by the kernel owner. Target profile: `dsg.core.refusal/3`.
Status: proposal, not published. Nothing here is pinned by any consumer.

## Problem

The kernel records refusal evidence events in its record layer. When a
governed route refuses, the route appends a refusal event that names the
record (by sha256) and, for decision routes, the decision that was
attempted. The HTTP refusal body is what the Console renders, and today it
cannot carry those two identifiers, so the person refusing sees the reason
but not which record or decision the refusal is about. The kernel currently
sends `recordId` and `decisionId` as undeclared extra fields on the
refusal body, which fails a consumer validating against the closed profile.

## Proposal

Extend the refusal document as `dsg.core.refusal/4` (or as an additive
extension to `/3`, whichever the IDL owners prefer) with two optional
fields:

| Field        | Type                                         | Presence | Meaning                                                                               |
| ------------ | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `recordId`   | hex string, 64 lowercase characters (sha256) | optional | the record stream the refusal is about, when the refusal concerns one specific record |
| `decisionId` | non-empty string                             | optional | the decision attempt the refusal is about, when the route is a decision route         |

Both stay optional. A refusal without governance context is exactly the
current `/3` body; a consumer that ignores the two fields is unaffected.

## Non-goals

- No new codes or stages. The code and stage unions are unchanged.
- No producer-specific field names on the shared envelope beyond these two.
- The kernel keeps carrying its own reason strings in `code` verbatim when
  no `RefusalCodeV3` value fits; that rule is already in force and is not
  changed here.

## Observed conflict: the published code union is closed

`RefusalV3Schema` in `@dynamicalsystems/idl` 0.14.0 types `code` as the
eight-value `RefusalCodeV3` union, and the conformance vector
`dsg.core.refusal_3/reject/refusal-unknown-code.json` rejects any other
value. Both producers rely on the rule quoted above and send their own
codes verbatim: the kernel's `RefusalReason` values (`identity`, `gate`,
`scope`, `token`, and the rest) and the plane's `session_expired`,
`unauthorized`, and `identity_incompatible`. Checked on 2026-09-14 with
`Value.Check(RefusalV3Schema, body)`: a plane 401 with code
`session_expired` and all five required fields is rejected by the shared
schema; the same body with `not_qualified` is accepted.

The consumer-facing package schemas (`PlaneRefusalSchema`,
`RefusalResponseSchema`) type `code` as a non-empty string, so a consumer
pinning those packages parses every producer body. A consumer validating
against the shared schema does not. This request should settle whether
`code` is open (any non-empty string, with the shared union as the
recommended vocabulary) or closed (in which case both producers must map
their reasons onto it). Until then, producer conformance against the
published vectors is limited to the fields other than `code`.
