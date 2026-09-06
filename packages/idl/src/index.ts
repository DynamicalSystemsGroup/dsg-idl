export { closed, Hex64, NonEmptyString, Orn, Reference, SafeInt, UtcSecond } from "./primitives.js";
export type { ProfileEntry } from "./primitives.js";
export {
  DISPATCH_CONSUME_PROFILE,
  DISPATCH_MAX_SKEW_SECONDS,
  DispatchConsumeRequestSchema,
  DispatchLeaseSchema,
  DispatchRefusalCodeSchema,
  DispatchRefusalSchema,
} from "./kernel/dispatch-consume.v1.js";
export type {
  DispatchConsumeRequest,
  DispatchLease,
  DispatchRefusal,
  DispatchRefusalCode,
} from "./kernel/dispatch-consume.v1.js";

import type { ProfileEntry } from "./primitives.js";
import { dispatchConsumeV1 } from "./kernel/dispatch-consume.v1.js";

/** Every profile this version of the package defines, keyed by literal.
 * Profile modules are added here as they are extracted; the rules test
 * and the schema emitter walk this registry, so a module that is not
 * registered does not exist. */
export const PROFILES: Readonly<Record<string, ProfileEntry>> = {
  [dispatchConsumeV1.literal]: dispatchConsumeV1,
};
