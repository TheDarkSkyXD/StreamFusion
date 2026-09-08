import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type {
  CapabilityProfileStore,
  RuntimeObservationReader,
} from "../capabilities/capability-profile";
import {
  DEGRADED_SAMPLING_INTERVAL_MS,
  NORMAL_SAMPLING_INTERVAL_MS,
} from "../domain/capability-profile";
import {
  createCapabilityProfileRuntimeController,
  type CapabilityProfileViewModel,
} from "./capability-profile-runtime-controller";

const initialModel: CapabilityProfileViewModel = {
  detail: "Measuring current Android resources.",
  observationAgeMs: null,
  persistence: "not-written",
  phase: "measuring",
  profile: null,
  projection: null,
};

export function useCapabilityProfileController(options: {
  readonly observationReader: RuntimeObservationReader;
  readonly store: CapabilityProfileStore;
}): {
  readonly model: CapabilityProfileViewModel;
  readonly retry: () => void;
} {
  const [model, setModel] = useState(initialModel);
  const retryAction = useRef<() => void>(() => undefined);
  const retry = useCallback(() => retryAction.current(), []);
  useEffect(() => {
    const controller = createCapabilityProfileRuntimeController({
      monotonicNowMs: () => globalThis.performance.now(),
      nowEpochMs: Date.now,
      observationReader: options.observationReader,
      sampler: {
        cancel: clearTimeout,
        degradedIntervalMs: DEGRADED_SAMPLING_INTERVAL_MS,
        isForeground: () => AppState.currentState === "active",
        normalIntervalMs: NORMAL_SAMPLING_INTERVAL_MS,
        schedule: setTimeout,
        subscribe: (onForegroundChange) =>
          AppState.addEventListener("change", (nextState) => {
            onForegroundChange(nextState === "active");
          }),
      },
      store: options.store,
    });
    const unsubscribe = controller.subscribe(setModel);
    retryAction.current = controller.retry;
    controller.start();
    return () => {
      unsubscribe();
      controller.dispose();
      retryAction.current = () => undefined;
    };
  }, [options.observationReader, options.store]);
  return { model, retry };
}
