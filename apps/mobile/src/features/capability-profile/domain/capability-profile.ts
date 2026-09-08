import type {
  AndroidResourceSnapshot,
  AndroidThermalState,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

export const CAPABILITY_PROFILE_MAX_AGE_MS = 150_000;
export const DEGRADED_SAMPLING_INTERVAL_MS = 120_000;
export const HEALTHY_OBSERVATIONS_TO_RECOVER = 3;
export const HEALTHY_RECOVERY_WINDOW_MS = 60_000;
export const NORMAL_SAMPLING_INTERVAL_MS = 30_000;

export type RuntimeDegradationStage = 0 | 1 | 2 | 3 | 4 | 5;

export type RuntimeMitigationId =
  | "reduce-background-refresh"
  | "lower-nonfocused-quality"
  | "thumbnail-nonfocused-video"
  | "pause-nonfocused-decoders"
  | "protect-focused-work";

export interface CapabilityProfile {
  readonly apiAbiFormFactorEligibility:
    | "development-emulator"
    | "physical-candidate"
    | "unsupported";
  readonly admission: {
    readonly activeVideoLimit: "unexercised";
    readonly captionSession: "unexercised";
    readonly download: "unexercised";
    readonly lowestProfile: "not-qualified";
    readonly recording: "unexercised";
  };
  readonly observation: AndroidResourceSnapshot;
}

export interface RuntimeWorkload {
  readonly configuredStreamSlotIds: readonly string[];
  readonly focusedTaskId: string | null;
  readonly recoverableArtifactIds: readonly string[];
}

export interface RuntimeDegradationState {
  readonly healthyObservationCount: number;
  readonly healthySinceMonotonicMs: number | null;
  readonly lastObservedAtEpochMs: number | null;
  readonly stage: RuntimeDegradationStage;
}

export interface RuntimeDegradationProjection {
  readonly actions: readonly RuntimeMitigationId[];
  readonly consumerStatus: readonly string[];
  readonly recoveryCondition: string;
  readonly stage: RuntimeDegradationStage;
  readonly visibleReason: string;
  readonly workload: RuntimeWorkload;
}

export interface RuntimeDegradationTransition {
  readonly projection: RuntimeDegradationProjection;
  readonly state: RuntimeDegradationState;
}

const actionByStage: Record<Exclude<RuntimeDegradationStage, 0>, RuntimeMitigationId> = {
  1: "reduce-background-refresh",
  2: "lower-nonfocused-quality",
  3: "thumbnail-nonfocused-video",
  4: "pause-nonfocused-decoders",
  5: "protect-focused-work",
};

export const initialRuntimeDegradationState: RuntimeDegradationState = {
  healthyObservationCount: 0,
  healthySinceMonotonicMs: null,
  lastObservedAtEpochMs: null,
  stage: 0,
};

export function createCapabilityProfile(
  observation: AndroidResourceSnapshot,
): CapabilityProfile {
  return {
    apiAbiFormFactorEligibility: apiAbiFormFactorEligibility(observation),
    admission: {
      activeVideoLimit: "unexercised",
      captionSession: "unexercised",
      download: "unexercised",
      lowestProfile: "not-qualified",
      recording: "unexercised",
    },
    observation,
  };
}

export function serializeCapabilityProfile(profile: CapabilityProfile): string {
  return JSON.stringify(profile);
}

export function advanceRuntimeDegradation(options: {
  readonly monotonicNowMs: number;
  readonly nowEpochMs: number;
  readonly observation: AndroidResourceSnapshot;
  readonly state: RuntimeDegradationState;
  readonly workload: RuntimeWorkload;
}): RuntimeDegradationTransition {
  const health = evaluateHealth(options.observation, options.nowEpochMs);
  const stateAfterObservationGap = observationGapExceeded(options.state, options.nowEpochMs)
    ? resetRecovery(options.state)
    : options.state;
  if (health.kind === "stale") {
    return transition(
      resetRecovery(stateAfterObservationGap),
      options.workload,
      "Current device evidence is stale. Refresh diagnostics before relaxing limits.",
      "A fresh device observation is required before recovery.",
    );
  }
  if (health.targetStage > stateAfterObservationGap.stage) {
    const state: RuntimeDegradationState = {
      healthyObservationCount: 0,
      healthySinceMonotonicMs: null,
      lastObservedAtEpochMs: latestObservedAt(stateAfterObservationGap, options.observation),
      stage: health.targetStage,
    };
    return transition(state, options.workload, health.reason, health.recoveryCondition);
  }
  if (stateAfterObservationGap.lastObservedAtEpochMs !== null &&
    options.observation.observedAtEpochMs <= stateAfterObservationGap.lastObservedAtEpochMs) {
    return transition(
      resetRecovery(stateAfterObservationGap),
      options.workload,
      "Device evidence did not advance. Existing limits remain in place.",
      "A newer device observation is required before recovery.",
    );
  }
  if (health.targetStage > 0) {
    const state: RuntimeDegradationState = {
      healthyObservationCount: 0,
      healthySinceMonotonicMs: null,
      lastObservedAtEpochMs: latestObservedAt(stateAfterObservationGap, options.observation),
      stage: stateAfterObservationGap.stage,
    };
    return transition(state, options.workload, health.reason, health.recoveryCondition);
  }
  if (stateAfterObservationGap.stage === 0) {
    return transition(
      {
        ...stateAfterObservationGap,
        lastObservedAtEpochMs: latestObservedAt(stateAfterObservationGap, options.observation),
      },
      options.workload,
      "Current device observation has no active pressure signal.",
      "No recovery is pending.",
    );
  }
  const healthySinceMonotonicMs = stateAfterObservationGap.healthySinceMonotonicMs ?? options.monotonicNowMs;
  const healthyObservationCount = stateAfterObservationGap.healthyObservationCount + 1;
  const elapsedHealthyMs = options.monotonicNowMs - healthySinceMonotonicMs;
  const mayRecover = healthyObservationCount >= HEALTHY_OBSERVATIONS_TO_RECOVER &&
    elapsedHealthyMs >= HEALTHY_RECOVERY_WINDOW_MS;
  const state: RuntimeDegradationState = {
    healthyObservationCount: mayRecover ? 0 : healthyObservationCount,
    healthySinceMonotonicMs: mayRecover ? null : healthySinceMonotonicMs,
    lastObservedAtEpochMs: latestObservedAt(stateAfterObservationGap, options.observation),
    stage: mayRecover ? previousStage(stateAfterObservationGap.stage) : stateAfterObservationGap.stage,
  };
  return transition(
    state,
    options.workload,
    mayRecover
      ? "Device health remained stable. One degradation stage was restored."
      : "Device health is stable, but limits remain while recovery hysteresis completes.",
    mayRecover
      ? "Another stable recovery window is required before restoring another stage."
      : `${HEALTHY_OBSERVATIONS_TO_RECOVER} fresh healthy observations over ${HEALTHY_RECOVERY_WINDOW_MS / 1_000} seconds are required.`,
  );
}

export function retainRuntimeDegradationForUnavailableObservation(options: {
  readonly detail: string;
  readonly state: RuntimeDegradationState;
  readonly workload: RuntimeWorkload;
}): RuntimeDegradationTransition {
  return transition(
    resetRecovery(options.state),
    options.workload,
    options.detail,
    "A current device observation is required before recovery.",
  );
}

function apiAbiFormFactorEligibility(
  observation: AndroidResourceSnapshot,
): CapabilityProfile["apiAbiFormFactorEligibility"] {
  const runtime = observation.runtime;
  const mobileFormFactor = runtime.formFactor.touchscreen &&
    !runtime.formFactor.automotive &&
    !runtime.formFactor.pc &&
    !runtime.formFactor.television &&
    !runtime.formFactor.watch;
  if (runtime.apiLevel < 30 || !mobileFormFactor) return "unsupported";
  if (runtime.executionEnvironment === "emulator" && runtime.supportedAbis.includes("x86_64")) {
    return "development-emulator";
  }
  return runtime.executionEnvironment === "physical" &&
    runtime.supportedAbis.includes("arm64-v8a")
    ? "physical-candidate"
    : "unsupported";
}

function evaluateHealth(
  observation: AndroidResourceSnapshot,
  nowEpochMs: number,
):
  | { readonly kind: "stale" }
  | {
      readonly kind: "current";
      readonly reason: string;
      readonly recoveryCondition: string;
      readonly targetStage: RuntimeDegradationStage;
    } {
  if (nowEpochMs - observation.observedAtEpochMs > CAPABILITY_PROFILE_MAX_AGE_MS) {
    return { kind: "stale" };
  }
  if (observation.observedAtEpochMs > nowEpochMs + 5_000) {
    return { kind: "stale" };
  }
  if (observation.memory.lowMemory) {
    return {
      kind: "current",
      reason: "Android reports low memory.",
      recoveryCondition: "Android must clear low-memory state and pass recovery hysteresis.",
      targetStage: 5,
    };
  }
  if (observation.storage.availableBytes < 1_073_741_824) {
    return {
      kind: "current",
      reason: "App-private storage is below the 1 GiB local protection reserve.",
      recoveryCondition: "Free storage above the local reserve and pass recovery hysteresis.",
      targetStage: 5,
    };
  }
  if (observation.thermal.kind === "unavailable") {
    return {
      kind: "current",
      reason: observation.thermal.detail,
      recoveryCondition: "A current Android thermal observation and recovery hysteresis are required.",
      targetStage: 1,
    };
  }
  return thermalHealth(observation.thermal.state);
}

function latestObservedAt(
  state: RuntimeDegradationState,
  observation: AndroidResourceSnapshot,
): number {
  return state.lastObservedAtEpochMs === null
    ? observation.observedAtEpochMs
    : Math.max(state.lastObservedAtEpochMs, observation.observedAtEpochMs);
}

function observationGapExceeded(
  state: RuntimeDegradationState,
  nowEpochMs: number,
): boolean {
  return state.lastObservedAtEpochMs !== null &&
    nowEpochMs - state.lastObservedAtEpochMs > CAPABILITY_PROFILE_MAX_AGE_MS;
}

function resetRecovery(
  state: RuntimeDegradationState,
): RuntimeDegradationState {
  return {
    ...state,
    healthyObservationCount: 0,
    healthySinceMonotonicMs: null,
  };
}

function thermalHealth(state: AndroidThermalState): Extract<ReturnType<typeof evaluateHealth>, { readonly kind: "current" }> {
  const targetStage: RuntimeDegradationStage = state === "none"
    ? 0
    : state === "light"
      ? 1
      : state === "moderate"
        ? 2
        : state === "severe"
          ? 4
          : 5;
  return {
    kind: "current",
    reason: targetStage === 0 ? "Android reports no thermal pressure." : `Android thermal status is ${state}.`,
    recoveryCondition: targetStage === 0
      ? "No recovery is pending."
      : "A lower thermal status and recovery hysteresis are required.",
    targetStage,
  };
}

function previousStage(stage: Exclude<RuntimeDegradationStage, 0>): RuntimeDegradationStage {
  return stage === 1 ? 0 : stage === 2 ? 1 : stage === 3 ? 2 : stage === 4 ? 3 : 4;
}

function transition(
  state: RuntimeDegradationState,
  workload: RuntimeWorkload,
  visibleReason: string,
  recoveryCondition: string,
): RuntimeDegradationTransition {
  const actions = stagesThrough(state.stage).map((stage) => actionByStage[stage]);
  return {
    projection: {
      actions,
      consumerStatus: state.stage >= 1
        ? [
            "Diagnostics sampling now uses the reduced foreground cadence.",
            "Playback, Media Jobs, captions, and storage mitigation consumers remain unavailable until their typed Android modules are implemented.",
          ]
        : ["Diagnostics sampling uses the normal foreground cadence."],
      recoveryCondition,
      stage: state.stage,
      visibleReason,
      workload,
    },
    state,
  };
}

function stagesThrough(stage: RuntimeDegradationStage): readonly Exclude<RuntimeDegradationStage, 0>[] {
  return stage === 0
    ? []
    : stage === 1
      ? [1]
      : stage === 2
        ? [1, 2]
        : stage === 3
          ? [1, 2, 3]
          : stage === 4
            ? [1, 2, 3, 4]
            : [1, 2, 3, 4, 5];
}

export function runtimeMitigationLabel(action: RuntimeMitigationId): string {
  return action === "reduce-background-refresh"
    ? "Reduce background refresh."
    : action === "lower-nonfocused-quality"
      ? "Lower nonfocused stream quality or frame rate."
      : action === "thumbnail-nonfocused-video"
        ? "Replace nonfocused video with refreshed thumbnails."
        : action === "pause-nonfocused-decoders"
          ? "Pause nonfocused decoders while retaining StreamSlots."
          : "Protect the focused player, recording finalization, and Product Store writes.";
}
