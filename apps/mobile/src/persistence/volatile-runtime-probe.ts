import type { RuntimeProbe } from "@mobile/capabilities/runtime-readiness";

export interface RuntimeProbeStore {
  delete(key: string): boolean;
  get(key: string): string | undefined;
  set(key: string, value: string): unknown;
}

export function createVolatilePersistenceProbe(
  options: { readonly store: RuntimeProbeStore } = { store: new Map() },
): RuntimeProbe {
  return {
    check() {
      const key = "streamfusion-runtime-probe";
      let ready = false;
      try {
        options.store.set(key, key);
        ready = options.store.get(key) === key;
      } catch {
        try {
          options.store.delete(key);
        } catch {
          return {
            kind: "unavailable",
            layer: "persistence",
            reason: "Volatile startup persistence cleanup failed.",
          };
        }
        return {
          kind: "unavailable",
          layer: "persistence",
          reason: "Volatile startup persistence is unavailable.",
        };
      }
      try {
        options.store.delete(key);
      } catch {
        return {
          kind: "unavailable",
          layer: "persistence",
          reason: "Volatile startup persistence cleanup failed.",
        };
      }
      return ready
        ? { kind: "ready", layer: "persistence" }
        : {
            kind: "unavailable",
            layer: "persistence",
            reason: "Volatile startup persistence failed verification.",
          };
    },
  };
}
