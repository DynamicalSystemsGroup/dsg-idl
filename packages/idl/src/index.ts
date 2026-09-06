export { closed, Hex64, NonEmptyString, SafeInt, UtcSecond } from "./primitives.js";
export type { ProfileEntry } from "./primitives.js";

import type { ProfileEntry } from "./primitives.js";

/** Every profile this version of the package defines, keyed by literal.
 * Profile modules are added here as they are extracted; the rules test
 * and the schema emitter walk this registry, so a module that is not
 * registered does not exist. */
export const PROFILES: Readonly<Record<string, ProfileEntry>> = {};
