import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import {
  PREDICTION_SETTING_KEY,
  type PredictionPreferences,
} from "../capabilities/prediction-settings";
import { serializePredictionPreferences } from "../domain/prediction-preferences";

export function createPredictionPreferenceStore(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
}): {
  read(): Promise<string | null>;
  write(value: PredictionPreferences): Promise<void>;
} {
  const now = input.now ?? Date.now;
  return {
    read() {
      return input.settings.read(PREDICTION_SETTING_KEY);
    },
    write(value) {
      return input.settings.write(
        PREDICTION_SETTING_KEY,
        serializePredictionPreferences(value),
        now(),
      );
    },
  };
}
