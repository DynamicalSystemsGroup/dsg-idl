// dsg.run.event/1
// Owner: dsg-run (the plane ingests, stores, streams, and seals) with the
// emitting library as the other side of the seam.
//
// One event a running workload emitted about itself. The workload writes
// these as single JSON lines on standard output, prefixed `DSGEV `, and
// knows nothing about how they travel: the executor that ran the job is
// the only thing that knows where its output went.
//
// Two things are closed and two are open by design. The ENVELOPE is
// closed: an unknown envelope field is a different protocol. The PAYLOAD
// is open here and closed by the catalog the emitter declared and the
// request pinned by digest - the plane validates the payload against that
// catalog, so this profile does not need to know a modeler's vocabulary
// to refuse an invalid instance of it.
//
// Ordering is the sequence number, never arrival and never the clock: a
// transport may duplicate or reorder, and the stored stream is the same
// either way. A gap is recorded as a fact, not smoothed over.
import { type Static, Type } from "@sinclair/typebox";
import {
  closed,
  Hex64,
  NonEmptyString,
  SafeInt,
  UtcSecond,
  type ProfileEntry,
} from "../primitives.js";

export const EVENT_PROFILE = "dsg.run.event/1" as const;

/** The wire prefix that lets a collector pick these lines out of ordinary
 *  job logs. One space, then the JSON object, then a newline. */
export const EVENT_LINE_PREFIX = "DSGEV " as const;

/** The lifecycle spine every catalog carries without declaring it: the
 *  kinds the console draws for any workload, whatever it models. A
 *  workload emitting only started and finished is fully described. */
export const LIFECYCLE_KINDS = [
  "started",
  "phase.entered",
  "phase.exited",
  "progress",
  "checkpoint",
  "artifact",
  "warning",
  "failure",
  "finished",
] as const;

const EventSchemaValue = closed({
  profile: Type.Literal(EVENT_PROFILE),
  /** The operation this event belongs to; injected into the job's
   *  environment by the plane, never chosen by the workload. */
  operation: NonEmptyString,
  /** Monotonic within one operation, from 1. Ordering lives here. */
  sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  at: UtcSecond,
  /** A lifecycle kind or one the pinned catalog declares. */
  kind: NonEmptyString,
  /** Digest of the catalog the payload validates against. */
  catalogSha256: Hex64,
  /** Validated against the catalog by digest, not by this schema: a
   *  modeler's vocabulary is theirs, and the plane refuses a payload the
   *  catalog does not admit. Artifacts are references, never contents. */
  payload: Type.Record(Type.String(), Type.Unknown()),
});
export const EventSchema: typeof EventSchemaValue = EventSchemaValue;
export type Event = Static<typeof EventSchema>;

/** What the plane seals into the outcome: the ordered stream's own digest,
 *  the catalog it validated against, and the count - enough for an
 *  offline reader holding the exported stream to recompute the verdict
 *  without the plane. `truncatedAtSequence` is the event ceiling's mark:
 *  a runaway logger is bounded, and the bound is visible rather than a
 *  silently short stream. */
const EventStreamSealSchemaValue = closed({
  profile: Type.Literal(EVENT_PROFILE),
  operation: NonEmptyString,
  catalogSha256: Hex64,
  /** sha256 over the newline-joined canonical event lines, in sequence. */
  streamSha256: Hex64,
  eventCount: SafeInt,
  /** Sequence numbers missing from an otherwise ordered stream. */
  gaps: Type.Array(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  truncatedAtSequence: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});
export const EventStreamSealSchema: typeof EventStreamSealSchemaValue = EventStreamSealSchemaValue;
export type EventStreamSeal = Static<typeof EventStreamSealSchema>;

export const eventV1: ProfileEntry = {
  literal: EVENT_PROFILE,
  rootShape: "event",
  shapes: { event: EventSchema, streamSeal: EventStreamSealSchema },
};
