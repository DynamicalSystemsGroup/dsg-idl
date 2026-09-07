import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { jcsStringify } from "@dynamicalsystems/orn-schemas";
import { EventSchema, EVENT_LINE_PREFIX } from "@dynamicalsystems/idl";
import type { ParseResult } from "./adapter.js";

/** Reference digest over source event lines, not over a precomputed seal document. */
export function streamDigest(bytes: Uint8Array): ParseResult {
  try {
    const events = new Map<number, string>();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    for (const line of text.split("\n")) {
      if (!line.startsWith(EVENT_LINE_PREFIX)) continue;
      const event: unknown = JSON.parse(line.slice(EVENT_LINE_PREFIX.length));
      if (!Value.Check(EventSchema, event)) return { ok: false, reason: "invalid event" };
      const canonical = jcsStringify(event);
      const previous = events.get(event.sequence);
      if (previous !== undefined && previous !== canonical) {
        return { ok: false, reason: "conflicting event sequence" };
      }
      events.set(event.sequence, canonical);
    }
    const stream = [...events]
      .sort(([a], [b]) => a - b)
      .map(([, line]) => line)
      .join("\n");
    return { ok: true, digest: createHash("sha256").update(stream).digest("hex") };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
}
