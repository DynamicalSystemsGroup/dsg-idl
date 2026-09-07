// The interface a consumer implements over its real boundary parser: the
// function that reads bytes off the wire, not the schema object. One parse
// function per shape position, addressed "<profile literal>#<shape>", so a
// vector exercises the exact code path that runs in production.
export type ParseResult =
  | { readonly ok: true; readonly digest?: string }
  | { readonly ok: false; readonly reason: string };

export type Adapter = Readonly<Record<string, (bytes: Uint8Array) => ParseResult>>;

/** One vector file on disk. `bytes` is base64 of the exact wire bytes:
 * re-serialization would normalize away the malformations reject vectors
 * exist to carry. A reject names the one rule it breaks. */
export type Vector = {
  readonly profile: string;
  readonly shape: string;
  readonly name: string;
  readonly verdict: "accept" | "reject";
  readonly rule?: string;
  readonly bytes: string;
  /** Digest vectors only: the expected sha256 of the canonical form of the
   * document in `bytes`, or the ordered event stream for digest.streamSeal. Source is NON-canonical
   * (different key order, whitespace), so agreement proves the consumer's
   * own canonicalize-and-digest path, not a byte copy. Stream bytes include DSGEV prefixes. */
  readonly sha256?: string;
  /** What agreeing on this vector obliges. "shape" (default): the boundary
   * parser's structural verdict. "semantic": a validator beyond shape
   * (law_contract.py, Rego decisions) must agree; shape-only adapters skip
   * these. Passing a finite corpus establishes agreement on those cases,
   * never equivalence. */
  readonly obligation?: "shape" | "semantic";
};
