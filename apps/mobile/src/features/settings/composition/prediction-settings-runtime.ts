import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import type {
  PredictionPreferencePatch,
  PredictionPreferences,
  PredictionSettingsSession,
  PredictionSettingsView,
} from "../capabilities/prediction-settings";
import { createPredictionPreferenceStore } from "../data/prediction-preference-store";
import {
  composePredictionSettingsView,
  defaultPredictionSettingsView,
  mergePredictionPreferences,
  parsePredictionPreferences,
} from "../domain/prediction-preferences";

export function createPredictionSettingsSession(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
}): PredictionSettingsSession {
  const store = createPredictionPreferenceStore({
    ...(input.now === undefined ? {} : { now: input.now }),
    settings: input.settings,
  });
  const listeners = new Set<() => void>();
  let cached = defaultPredictionSettingsView();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  async function hydrate(): Promise<PredictionSettingsView> {
    cached = composePredictionSettingsView(
      parsePredictionPreferences(await store.read()),
    );
    notify();
    return cached;
  }

  return {
    peek: () => cached,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: () => hydrate(),
    async apply(patch: PredictionPreferencePatch) {
      const next = mergePredictionPreferences(cached.preferences, patch);
      await store.write(next);
      return hydrate();
    },
    async snapshot(): Promise<PredictionPreferences> {
      return parsePredictionPreferences(await store.read());
    },
  };
}
