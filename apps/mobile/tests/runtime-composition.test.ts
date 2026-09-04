import { describe, expect, it } from "vitest";

import type { AppMetadataReader } from "@mobile/capabilities/app-metadata";
import type { RuntimeProbeStore } from "@mobile/persistence/volatile-runtime-probe";
import { createDevelopmentClientController } from "@mobile/features/development/development-client-controller";
import { createVolatilePersistenceProbe } from "@mobile/persistence/volatile-runtime-probe";
import { createFetchRuntimeProbe } from "@mobile/transport/fetch-runtime-probe";

const appMetadata: AppMetadataReader = {
  read() {
    return {
      name: "StreamFusion Mobile",
      version: "0.1.0",
      runtimeHost: "expo-go",
    };
  },
};

describe("Mobile runtime composition", () => {
  it("reports every composed runtime layer ready", () => {
    const controller = createDevelopmentClientController({
      appMetadata,
      runtimeProbes: [
        createFetchRuntimeProbe({ fetchImplementation: fetch }),
        createVolatilePersistenceProbe(),
      ],
      supportedPlatforms: ["twitch", "kick"],
    });

    expect(controller.read()).toEqual({
      layerStatus: "2/2 runtime services ready.",
      providerStatus: "2 provider contracts ready.",
      runtimeStatus: "Android Expo Go runtime is composed.",
      title: "StreamFusion Mobile",
      version: "Version 0.1.0",
    });
  });

  it("contains transport failure without running a request", () => {
    expect(
      createFetchRuntimeProbe({ fetchImplementation: undefined }).check(),
    ).toEqual({
      kind: "unavailable",
      layer: "transport",
      reason: "Fetch transport is unavailable.",
    });
  });

  it("shows contained runtime failures in the controller state", () => {
    const controller = createDevelopmentClientController({
      appMetadata,
      runtimeProbes: [
        createFetchRuntimeProbe({ fetchImplementation: undefined }),
        createVolatilePersistenceProbe(),
      ],
      supportedPlatforms: ["twitch", "kick"],
    });

    expect(controller.read().layerStatus).toBe(
      "Fetch transport is unavailable.",
    );
  });

  it("cleans the persistence probe after success and failure", () => {
    const storage = new Map<string, string>();
    expect(createVolatilePersistenceProbe({ store: storage }).check()).toEqual({
      kind: "ready",
      layer: "persistence",
    });
    expect(storage.size).toBe(0);

    const failingStore: RuntimeProbeStore = {
      delete() {
        return true;
      },
      get() {
        return undefined;
      },
      set() {
        throw new Error("unavailable");
      },
    };
    expect(
      createVolatilePersistenceProbe({ store: failingStore }).check(),
    ).toEqual({
      kind: "unavailable",
      layer: "persistence",
      reason: "Volatile startup persistence is unavailable.",
    });
  });
});
