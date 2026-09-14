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

| Field | Type | Presence | Meaning |
| --- | --- | --- | --- |
| `recordId` | hex string, 64 lowercase characters (sha256) | optional | the record stream the refusal is about, when the refusal concerns one specific record |
| `decisionId` | non-empty string | optional | the decision attempt the refusal is about, when the route is a decision route |

Both stay optional. A refusal without governance context is exactly the
current `/3` body; a consumer that ignores the two fields is unaffected.

## Non-goals

- No new codes or stages. The code and stage unions are unchanged.
- No producer-specific field names on the shared envelope beyond these two.
- The kernel keeps carrying its own reason strings in `code` verbatim when
  no `RefusalCodeV3` value fits; that rule is already in force and is not
  changed here.
