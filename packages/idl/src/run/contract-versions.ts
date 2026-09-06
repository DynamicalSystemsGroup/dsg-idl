// In-process contract versions of the dsg-run plane. Under ruling I7 these
// are NOT profiles: an executor or provider adapter is a TypeScript plugin
// interface inside one process, with no serialized shape or digest of its
// own - its documents (operation requests, descriptors) already have
// profiles. The literals live here so no consumer repo defines a
// dsg.*.*/N string and the CI grep stays absolute. When R06 gives
// executors a real serialized job document, THAT becomes a profile module
// beside this file.
export const EXECUTOR_PROTOCOL_VERSION = "dsg.run.executor/1" as const;
export type ExecutorProtocolVersion = typeof EXECUTOR_PROTOCOL_VERSION;

export const PROVIDER_PROTOCOL_VERSION = "dsg.run.provider/1" as const;
export type ProviderProtocolVersion = typeof PROVIDER_PROTOCOL_VERSION;
