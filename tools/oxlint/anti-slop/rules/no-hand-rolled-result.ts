import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/** The exact keys a hand-rolled Result-shaped object literal carries. Real
 *  `Result` values are `Ok`/`Err` class instances (methods, `isOk`/`isErr`),
 *  never a plain `{status, value}` / `{status, error}` object - and this
 *  repo's own `RecordApi`, `AuthorityDecision`, and knowledge/sandbox APIs
 *  all return `better-result`'s `Result`, so a literal in this exact shape
 *  is never a legitimate unrelated type (contrast `DoctorCheck`'s
 *  `{name, status, message}`, which this rule does not match). */
const OK_KEYS: Record<string, true> = { status: true, value: true };
const ERR_KEYS: Record<string, true> = { status: true, error: true };

/** Matcher names whose expected argument is compared structurally, never
 *  called as a `Result`. `expect(await sink.readFailure(x)).toEqual({
 *  status: "ok", value })` asserts the real `Result`'s shape; the literal
 *  on the right is a comparison target, not a stand-in interface. */
const COMPARISON_MATCHERS: Record<string, true> = {
  toEqual: true,
  toStrictEqual: true,
  toContainEqual: true,
};

function staticKeyName(key: ESTree.PropertyKey): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

function isResultStatusLiteral(value: ESTree.Expression, expected: "ok" | "error"): boolean {
  return value.type === "Literal" && value.value === expected;
}

/** True when `node`'s own (non-spread) keys are exactly `OK_KEYS` or
 *  exactly `ERR_KEYS`, with `status` carrying the matching literal. Extra
 *  or missing keys, a computed/spread key, or a non-literal `status` value
 *  all fall through - this only catches the precise mimicked shape. */
function resultMockKind(node: ESTree.ObjectExpression): "ok" | "error" | null {
  const keys: string[] = [];
  let statusValue: ESTree.Expression | null = null;
  for (const property of node.properties) {
    if (property.type !== "Property" || property.computed) return null;
    const name = staticKeyName(property.key);
    if (name === null) return null;
    keys.push(name);
    if (name === "status") statusValue = property.value;
  }
  if (statusValue === null) return null;

  const seenKeys = new Set(keys);
  const okKeyNames = Object.keys(OK_KEYS);
  const errKeyNames = Object.keys(ERR_KEYS);
  if (keys.length === okKeyNames.length && okKeyNames.every((key) => seenKeys.has(key))) {
    return isResultStatusLiteral(statusValue, "ok") ? "ok" : null;
  }
  if (keys.length === errKeyNames.length && errKeyNames.every((key) => seenKeys.has(key))) {
    return isResultStatusLiteral(statusValue, "error") ? "error" : null;
  }
  return null;
}

/** True when `node` sits inside the argument list of a `.toEqual(...)` /
 *  `.toStrictEqual(...)` / `.toContainEqual(...)` call anywhere in its
 *  ancestor chain - a comparison target, not a substitute Result. Walks
 *  `.parent` links rather than a fixed depth, so nesting inside an array
 *  or object literal (`toEqual([{status: "ok", value}])`) still exempts. */
function isComparisonTarget(node: ESTree.Node): boolean {
  let current: ESTree.Node = node;
  let parent: ESTree.Node | null = current.parent;
  while (parent !== null) {
    if (
      parent.type === "CallExpression" &&
      parent.callee.type === "MemberExpression" &&
      !parent.callee.computed &&
      parent.callee.property.type === "Identifier" &&
      parent.callee.property.name in COMPARISON_MATCHERS &&
      (parent.arguments as readonly ESTree.Node[]).includes(current)
    ) {
      return true;
    }
    current = parent;
    parent = current.parent;
  }
  return false;
}

/** Ban a hand-rolled `{status: "ok", value}` / `{status: "error", error}`
 *  object literal standing in for `better-result`'s `Result`. Three test
 *  files independently reinvented this exact broken shape in one night
 *  (issue #37): a plain object literal has no `isOk`/`isErr`/`map`, and
 *  the mismatch surfaces only once the required `as unknown as` cast is
 *  removed. Use `Result.ok(value)` / `Result.err(error)`, or a schema-
 *  validated fixture builder that returns the real type. */
export const noHandRolledResultRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow object literals mimicking better-result's Result shape; use Result.ok/Result.err or a real fixture builder.",
    },
    messages: {
      handRolledResult:
        'Replace this hand-rolled {status: "{{status}}", ...} literal with Result.{{ctor}}(...) or a schema-validated fixture builder that returns the real Result type.',
    },
  },
  createOnce(context) {
    return {
      ObjectExpression(node) {
        const kind = resultMockKind(node);
        if (kind === null) return;
        if (isComparisonTarget(node)) return;
        context.report({
          node,
          messageId: "handRolledResult",
          data: { status: kind, ctor: kind === "ok" ? "ok" : "err" },
        });
      },
    };
  },
});
