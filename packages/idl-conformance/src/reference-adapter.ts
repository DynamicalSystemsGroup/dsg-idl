// The adapter the package itself is judged by: TypeBox Value.Check over
// the registered schemas. Consumers implement their own adapter over their
// real parser; this one exists so a profile PR proves its vectors against
// the schemas before any consumer sees them.
import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { jcsStringify } from "@dynamicalsystems/orn-schemas";
import { PROFILES, EVENT_PROFILE } from "@dynamicalsystems/idl";
import type { Adapter, ParseResult } from "./adapter.js";
import { streamDigest } from "./stream-digest.js";
import { releaseSemanticAdapters } from "./release-semantics.js";

export function referenceAdapter(): Adapter {
  const adapter: Record<string, (bytes: Uint8Array) => ParseResult> = {};
  for (const entry of Object.values(PROFILES)) {
    adapter[`${entry.literal}#digest.envelope`] = (bytes) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch (error) {
        return { ok: false, reason: `not UTF-8 JSON: ${String(error)}` };
      }
      const digest = createHash("sha256").update(jcsStringify(parsed)).digest("hex");
      return { ok: true, digest };
    };
    for (const [documentName, documentSchema] of Object.entries(entry.documents)) {
      adapter[`${entry.literal}#${documentName}`] = (bytes) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        } catch (error) {
          return { ok: false, reason: `not UTF-8 JSON: ${String(error)}` };
        }
        if (Value.Check(documentSchema, parsed)) return { ok: true };
        const first = Value.Errors(documentSchema, parsed).First();
        return {
          ok: false,
          reason: `${first?.path ?? ""}: ${first?.message ?? "schema mismatch"}`,
        };
      };
    }
  }
  adapter[`${EVENT_PROFILE}#digest.streamSeal`] = streamDigest;
  Object.assign(adapter, releaseSemanticAdapters());
  return adapter;
}
