import { describe, expect, it } from "vitest";

import type { AndroidResourceSnapshot } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

import { createCapabilityProfileRuntimeController } from "../components/capability-profile-runtime-controller";

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function snapshot(
  observedAtEpochMs: number,
  thermal: AndroidResourceSnapshot["thermal"] = { kind: "observed", state: "none" },
): AndroidResourceSnapshot {
  return {
    decoders: [],
    memory: {
      availableBytes: 4_294_967_296,
      lowMemory: false,
      runtimeFreeBytes: 524_288_000,
      runtimeMaxBytes: 1_073_741_824,
      runtimeTotalBytes: 549_453_824,
      thresholdBytes: 268_435_456,
      totalBytes: 8_589_934_592,
    },
    observedAtEpochMs,
    runtime: {
      apiLevel: 30,
      applicationId: "com.thedarkskyxd.streamfusion.dev",
      executionEnvironment: "emulator",
      formFactor: {
        automotive: false,
        pc: false,
        touchscreen: true,
        television: false,
        uiModeType: 1,
        watch: false,
      },
      supportedAbis: ["x86_64"],
      versionCode: 1,
    },
    storage: { availableBytes: 8_589_934_592, totalBytes: 17_179_869_184 },
    thermal,
  };
}

describe("Capability profile runtime controller", () => {
  it("retains degradation after a diagnostics view unsubscribes and clears resources only on runtime disposal", async () => {
    const scheduled: { callback: () => void; token: number }[] = [];
    const cancelled: number[] = [];
    let removed = false;
    let persisted: string | null = null;
    const controller = createCapabilityProfileRuntimeController({
      monotonicNowMs: () => 1,
      nowEpochMs: () => 1_000,
      observationReader: {
        read: async () => ({
          kind: "observed",
          snapshot: snapshot(1_000, { kind: "observed", state: "critical" }),
        }),
      },
      sampler: {
        cancel: (token) => cancelled.push(token),
        degradedIntervalMs: 120_000,
        isForeground: () => true,
        normalIntervalMs: 30_000,
        schedule: (callback) => {
          const token = scheduled.length + 1;
          scheduled.push({ callback, token });
          return token;
        },
        subscribe: () => ({ remove: () => { removed = true; } }),
      },
      store: {
        read: async () => persisted,
        write: async (value) => { persisted = value; },
      },
    });
    const unsubscribe = controller.subscribe(() => undefined);
    controller.start();
    await flushAsyncWork();
    unsubscribe();

    expect(controller.snapshot().projection?.stage).toBe(5);
    expect(controller.snapshot().persistence).toBe("history-confirmed");
    expect(scheduled).toHaveLength(1);
    controller.dispose();
    expect(cancelled).toEqual([1]);
    expect(removed).toBe(true);
  });

  it("keeps limits, resets recovery, and retries after a rejected measurement", async () => {
    let reads = 0;
    const scheduled: { callback: () => void; token: number }[] = [];
    const cancelled: number[] = [];
    const phases: string[] = [];
    const controller = createCapabilityProfileRuntimeController({
      monotonicNowMs: () => 1,
      nowEpochMs: () => 1_000,
      observationReader: {
        read: async () => {
          reads += 1;
          if (reads === 1) throw new Error("native call failed");
          if (reads === 3) {
            return { kind: "unavailable", detail: "The Android source is unavailable." };
          }
          return { kind: "observed", snapshot: snapshot(1_000) };
        },
      },
      sampler: {
        cancel: (token) => cancelled.push(token),
        degradedIntervalMs: 120_000,
        isForeground: () => true,
        normalIntervalMs: 30_000,
        schedule: (callback) => {
          const token = scheduled.length + 1;
          scheduled.push({ callback, token });
          return token;
        },
        subscribe: () => ({ remove: () => undefined }),
      },
      store: { read: async () => null, write: async () => undefined },
    });
    controller.subscribe((model) => phases.push(model.phase));
    controller.start();
    await flushAsyncWork();
    expect(controller.snapshot().detail).toContain("did not complete");
    expect(scheduled).toHaveLength(1);

    controller.retry();
    controller.retry();
    expect(controller.snapshot().phase).toBe("measuring");
    expect(cancelled).toEqual([1]);
    await flushAsyncWork();
    expect(reads).toBe(2);
    expect(controller.snapshot().projection?.stage).toBe(0);
    expect(controller.snapshot().phase).toBe("observed");
    scheduled[1]?.callback();
    await flushAsyncWork();
    expect(controller.snapshot().phase).toBe("unavailable");
    expect(phases).toEqual([
      "measuring",
      "measuring",
      "unavailable",
      "measuring",
      "observed",
      "measuring",
      "unavailable",
    ]);
    controller.dispose();
  });
});
