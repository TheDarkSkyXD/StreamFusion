import type { RuntimeProbe } from "@mobile/capabilities/runtime-readiness";

export function createFetchRuntimeProbe(
  options: {
    readonly fetchImplementation: typeof fetch | undefined;
  } = { fetchImplementation: globalThis.fetch },
): RuntimeProbe {
  return {
    check() {
      return options.fetchImplementation
        ? { kind: "ready", layer: "transport" }
        : {
            kind: "unavailable",
            layer: "transport",
            reason: "Fetch transport is unavailable.",
          };
    },
  };
}
