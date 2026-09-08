import type {
  CapabilityProfileStore,
  RuntimeObservationReader,
} from "../capabilities/capability-profile";
import {
  advanceRuntimeDegradation,
  createCapabilityProfile,
  initialRuntimeDegradationState,
  retainRuntimeDegradationForUnavailableObservation,
  type CapabilityProfile,
  type RuntimeDegradationProjection,
  type RuntimeDegradationState,
  type RuntimeWorkload,
} from "../domain/capability-profile";
import {
  createForegroundCapabilityProfileSampler,
  type ForegroundCapabilityProfileSampler,
  type ForegroundCapabilityProfileSamplerOptions,
} from "./foreground-capability-profile-sampler";

export interface CapabilityProfileViewModel {
  readonly detail: string;
  readonly observationAgeMs: number | null;
  readonly persistence: "history-confirmed" | "history-unconfirmed" | "not-written";
  readonly phase: "measuring" | "observed" | "unavailable";
  readonly profile: CapabilityProfile | null;
  readonly projection: RuntimeDegradationProjection | null;
}

export interface CapabilityProfileRuntimeController {
  dispose(): void;
  retry(): void;
  snapshot(): CapabilityProfileViewModel;
  start(): void;
  subscribe(listener: (model: CapabilityProfileViewModel) => void): () => void;
}

const emptyWorkload: RuntimeWorkload = {
  configuredStreamSlotIds: [],
  focusedTaskId: null,
  recoverableArtifactIds: [],
};

const initialModel: CapabilityProfileViewModel = {
  detail: "Measuring current Android resources.",
  observationAgeMs: null,
  persistence: "not-written",
  phase: "measuring",
  profile: null,
  projection: null,
};

export function createCapabilityProfileRuntimeController(options: {
  readonly monotonicNowMs: () => number;
  readonly nowEpochMs: () => number;
  readonly observationReader: RuntimeObservationReader;
  readonly sampler: Omit<ForegroundCapabilityProfileSamplerOptions, "runSample">;
  readonly store: CapabilityProfileStore;
  readonly workload?: RuntimeWorkload;
}): CapabilityProfileRuntimeController {
  const listeners = new Set<(model: CapabilityProfileViewModel) => void>();
  const workload = options.workload ?? emptyWorkload;
  let model = initialModel;
  let state: RuntimeDegradationState = initialRuntimeDegradationState;
  const publish = (next: CapabilityProfileViewModel) => {
    model = next;
    listeners.forEach((listener) => listener(model));
  };
  const unavailable = (detail: string) => {
    const transition = retainRuntimeDegradationForUnavailableObservation({
      detail,
      state,
      workload,
    });
    state = transition.state;
    publish({
      detail,
      observationAgeMs: null,
      persistence: "not-written",
      phase: "unavailable",
      profile: null,
      projection: transition.projection,
    });
    return transition.state.stage;
  };
  const sampler: ForegroundCapabilityProfileSampler =
    createForegroundCapabilityProfileSampler({
      ...options.sampler,
      onSampleStart: () => {
        publish({
          ...model,
          detail: "Measuring current Android resources.",
          phase: "measuring",
        });
      },
      runSample: async () => {
        let result: Awaited<ReturnType<RuntimeObservationReader["read"]>>;
        try {
          result = await options.observationReader.read();
        } catch {
          return unavailable(
            "Android resource measurement did not complete. Existing limits remain in place.",
          );
        }
        if (result.kind === "unavailable") return unavailable(result.detail);

        const profile = createCapabilityProfile(result.snapshot);
        const sampledAtEpochMs = options.nowEpochMs();
        const transition = advanceRuntimeDegradation({
          monotonicNowMs: options.monotonicNowMs(),
          nowEpochMs: sampledAtEpochMs,
          observation: result.snapshot,
          state,
          workload,
        });
        state = transition.state;
        const serializedProfile = JSON.stringify(profile);
        let detail = transition.projection.visibleReason;
        let persistence: CapabilityProfileViewModel["persistence"] = "history-confirmed";
        try {
          await options.store.write(
            serializedProfile,
            result.snapshot.observedAtEpochMs,
          );
          if (await options.store.read() !== serializedProfile) {
            persistence = "history-unconfirmed";
            detail = `${detail} The latest profile could not be confirmed in local history.`;
          }
        } catch {
          persistence = "history-unconfirmed";
          detail = `${detail} The latest profile could not be saved.`;
        }
        publish({
          detail,
          observationAgeMs: sampledAtEpochMs - result.snapshot.observedAtEpochMs,
          persistence,
          phase: "observed",
          profile,
          projection: transition.projection,
        });
        return transition.state.stage;
      },
    });
  return {
    dispose: () => sampler.dispose(),
    retry: () => sampler.refresh(),
    snapshot: () => model,
    start: () => sampler.start(),
    subscribe(listener) {
      listeners.add(listener);
      listener(model);
      return () => listeners.delete(listener);
    },
  };
}
