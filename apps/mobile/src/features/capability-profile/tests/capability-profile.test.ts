import { describe, expect, it } from "vitest";

import type {
  AndroidResourceSnapshot,
  AndroidThermalState,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

import {
  advanceRuntimeDegradation,
  createCapabilityProfile,
  initialRuntimeDegradationState,
} from "../domain/capability-profile";

function snapshot(
  observedAtEpochMs: number,
  overrides: Partial<AndroidResourceSnapshot> = {},
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
    thermal: { kind: "observed", state: "none" },
    ...overrides,
  };
}

const workload = {
  configuredStreamSlotIds: ["slot-a", "slot-b"],
  focusedTaskId: "watch:slot-a",
  recoverableArtifactIds: ["recording:42", "download:9"],
} as const;

describe("Capability Profile", () => {
  it("separates API ABI eligibility from unexercised workload admission", () => {
    const profile = createCapabilityProfile(snapshot(10));
    expect(profile.apiAbiFormFactorEligibility).toBe("development-emulator");
    expect(profile.admission).toEqual({
      activeVideoLimit: "unexercised",
      captionSession: "unexercised",
      download: "unexercised",
      lowestProfile: "not-qualified",
      recording: "unexercised",
    });
  });

  it("applies cumulative protection immediately without changing focused work or artifacts", () => {
    const transition = advanceRuntimeDegradation({
      monotonicNowMs: 1,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, {
        thermal: { kind: "observed", state: "critical" },
      }),
      state: initialRuntimeDegradationState,
      workload,
    });
    expect(transition.state.stage).toBe(5);
    expect(transition.projection.actions).toEqual([
      "reduce-background-refresh",
      "lower-nonfocused-quality",
      "thumbnail-nonfocused-video",
      "pause-nonfocused-decoders",
      "protect-focused-work",
    ]);
    expect(transition.projection.workload).toEqual(workload);
  });

  it("resets hysteresis after stale evidence and requires monotonic healthy time", () => {
    const constrained = advanceRuntimeDegradation({
      monotonicNowMs: 0,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, {
        thermal: { kind: "observed", state: "severe" },
      }),
      state: initialRuntimeDegradationState,
      workload,
    });
    const healthyOne = advanceRuntimeDegradation({
      monotonicNowMs: 10,
      nowEpochMs: 1_010,
      observation: snapshot(1_010),
      state: constrained.state,
      workload,
    });
    const healthyTwo = advanceRuntimeDegradation({
      monotonicNowMs: 20,
      nowEpochMs: 1_020,
      observation: snapshot(1_020),
      state: healthyOne.state,
      workload,
    });
    const stale = advanceRuntimeDegradation({
      monotonicNowMs: 30,
      nowEpochMs: 200_000,
      observation: snapshot(1_020),
      state: healthyTwo.state,
      workload,
    });
    const healthyAfterGap = advanceRuntimeDegradation({
      monotonicNowMs: 120_000,
      nowEpochMs: 200_010,
      observation: snapshot(200_010),
      state: stale.state,
      workload,
    });
    expect(stale.state.healthyObservationCount).toBe(0);
    expect(healthyAfterGap.state.stage).toBe(4);
    expect(healthyAfterGap.state.healthyObservationCount).toBe(1);
  });

  it("allows severe pressure to raise protection after a future-dated observation", () => {
    const futureDated = advanceRuntimeDegradation({
      monotonicNowMs: 1,
      nowEpochMs: 1_000,
      observation: snapshot(8_000),
      state: { ...initialRuntimeDegradationState, stage: 1 },
      workload,
    });
    const severe = advanceRuntimeDegradation({
      monotonicNowMs: 2,
      nowEpochMs: 1_001,
      observation: snapshot(1_001, {
        thermal: { kind: "observed", state: "severe" },
      }),
      state: futureDated.state,
      workload,
    });
    expect(futureDated.state.healthyObservationCount).toBe(0);
    expect(severe.state.stage).toBe(4);
  });

  it("restores exactly one stage after three healthy observations across the local monotonic window", () => {
    const constrained = advanceRuntimeDegradation({
      monotonicNowMs: 0,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, { thermal: { kind: "observed", state: "critical" } }),
      state: initialRuntimeDegradationState,
      workload,
    });
    const healthyOne = advanceRuntimeDegradation({
      monotonicNowMs: 10,
      nowEpochMs: 1_010,
      observation: snapshot(1_010),
      state: constrained.state,
      workload,
    });
    const healthyTwo = advanceRuntimeDegradation({
      monotonicNowMs: 30_000,
      nowEpochMs: 31_000,
      observation: snapshot(31_000),
      state: healthyOne.state,
      workload,
    });
    const recovered = advanceRuntimeDegradation({
      monotonicNowMs: 60_010,
      nowEpochMs: 61_010,
      observation: snapshot(61_010),
      state: healthyTwo.state,
      workload,
    });
    expect(recovered.state.stage).toBe(4);
    expect(recovered.state.healthyObservationCount).toBe(0);
  });

  it("does not let a wall-clock jump bypass the monotonic recovery window", () => {
    const constrained = advanceRuntimeDegradation({
      monotonicNowMs: 0,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, { thermal: { kind: "observed", state: "critical" } }),
      state: initialRuntimeDegradationState,
      workload,
    });
    const healthyOne = advanceRuntimeDegradation({
      monotonicNowMs: 1,
      nowEpochMs: 1_001,
      observation: snapshot(1_001),
      state: constrained.state,
      workload,
    });
    const healthyTwo = advanceRuntimeDegradation({
      monotonicNowMs: 15_000,
      nowEpochMs: 9_999_999_999,
      observation: snapshot(9_999_999_999),
      state: healthyOne.state,
      workload,
    });
    const stillConstrained = advanceRuntimeDegradation({
      monotonicNowMs: 30_000,
      nowEpochMs: 10_000_000_000,
      observation: snapshot(10_000_000_000),
      state: healthyTwo.state,
      workload,
    });
    expect(stillConstrained.state.stage).toBe(5);
    expect(stillConstrained.state.healthyObservationCount).toBe(2);
  });

  it("resets recovery evidence after a foreground observation gap even when the resumed snapshot is fresh", () => {
    const constrained = advanceRuntimeDegradation({
      monotonicNowMs: 1_000,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, { thermal: { kind: "observed", state: "critical" } }),
      state: initialRuntimeDegradationState,
      workload,
    });
    const healthyOne = advanceRuntimeDegradation({
      monotonicNowMs: 2_000,
      nowEpochMs: 2_000,
      observation: snapshot(2_000),
      state: constrained.state,
      workload,
    });
    const healthyTwo = advanceRuntimeDegradation({
      monotonicNowMs: 32_000,
      nowEpochMs: 32_000,
      observation: snapshot(32_000),
      state: healthyOne.state,
      workload,
    });
    const resumed = advanceRuntimeDegradation({
      monotonicNowMs: 300_000,
      nowEpochMs: 300_000,
      observation: snapshot(300_000),
      state: healthyTwo.state,
      workload,
    });
    expect(resumed.state.stage).toBe(5);
    expect(resumed.state.healthyObservationCount).toBe(1);
  });

  it.each<[AndroidThermalState, number]>([
    ["none", 0],
    ["light", 1],
    ["moderate", 2],
    ["severe", 4],
    ["critical", 5],
    ["emergency", 5],
    ["shutdown", 5],
  ])("maps Android thermal %s to stage %i", (thermalState, expectedStage) => {
    const transition = advanceRuntimeDegradation({
      monotonicNowMs: 1,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, { thermal: { kind: "observed", state: thermalState } }),
      state: initialRuntimeDegradationState,
      workload,
    });
    expect(transition.state.stage).toBe(expectedStage);
  });

  it("keeps protection for unavailable or duplicate evidence", () => {
    const unavailable = advanceRuntimeDegradation({
      monotonicNowMs: 1,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, { thermal: { detail: "Android thermal status was unavailable.", kind: "unavailable" } }),
      state: { ...initialRuntimeDegradationState, stage: 4 },
      workload,
    });
    const healthy = advanceRuntimeDegradation({
      monotonicNowMs: 2,
      nowEpochMs: 1_001,
      observation: snapshot(1_001),
      state: unavailable.state,
      workload,
    });
    const duplicate = advanceRuntimeDegradation({
      monotonicNowMs: 3,
      nowEpochMs: 1_002,
      observation: snapshot(1_001),
      state: healthy.state,
      workload,
    });
    expect(unavailable.state.stage).toBe(4);
    expect(healthy.state.healthyObservationCount).toBe(1);
    expect(duplicate.state.healthyObservationCount).toBe(0);
    expect(duplicate.state.stage).toBe(4);
  });

  it("reserves stage five for low-memory and below-reserve storage observations", () => {
    const lowMemory = advanceRuntimeDegradation({
      monotonicNowMs: 1,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, { memory: { ...snapshot(1_000).memory, lowMemory: true } }),
      state: initialRuntimeDegradationState,
      workload,
    });
    const belowReserveStorage = advanceRuntimeDegradation({
      monotonicNowMs: 1,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, { storage: { availableBytes: 1_073_741_823, totalBytes: 2_147_483_648 } }),
      state: initialRuntimeDegradationState,
      workload,
    });
    const reserveBoundary = advanceRuntimeDegradation({
      monotonicNowMs: 1,
      nowEpochMs: 1_000,
      observation: snapshot(1_000, { storage: { availableBytes: 1_073_741_824, totalBytes: 2_147_483_648 } }),
      state: initialRuntimeDegradationState,
      workload,
    });
    expect(lowMemory.state.stage).toBe(5);
    expect(belowReserveStorage.state.stage).toBe(5);
    expect(reserveBoundary.state.stage).toBe(0);
  });

  it("rejects unsupported API, ABI, and non-phone form factors from candidate eligibility", () => {
    expect(createCapabilityProfile(snapshot(1, {
      runtime: { ...snapshot(1).runtime, apiLevel: 29 },
    })).apiAbiFormFactorEligibility).toBe("unsupported");
    expect(createCapabilityProfile(snapshot(1, {
      runtime: {
        ...snapshot(1).runtime,
        executionEnvironment: "physical",
        supportedAbis: ["arm64-v8a"],
      },
    })).apiAbiFormFactorEligibility).toBe("physical-candidate");
    for (const formFactor of ["automotive", "pc", "television", "watch"] as const) {
      expect(createCapabilityProfile(snapshot(1, {
        runtime: {
          ...snapshot(1).runtime,
          formFactor: { ...snapshot(1).runtime.formFactor, [formFactor]: true },
        },
      })).apiAbiFormFactorEligibility).toBe("unsupported");
    }
  });
});
