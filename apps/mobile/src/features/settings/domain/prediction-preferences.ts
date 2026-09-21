import type {
  PredictionPreferencePatch,
  PredictionPreferences,
  PredictionSettingsView,
  PredictionStyle,
} from "../capabilities/prediction-settings";

export const DEFAULT_PREDICTION_PREFERENCES: PredictionPreferences = {
  style: "native",
};

const STYLES: readonly PredictionStyle[] = ["native", "unified"];

export function parsePredictionPreferences(
  raw: string | null,
): PredictionPreferences {
  if (raw == null || raw.length === 0) {
    return DEFAULT_PREDICTION_PREFERENCES;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PredictionPreferences>;
    return mergePredictionPreferences(DEFAULT_PREDICTION_PREFERENCES, parsed);
  } catch {
    return DEFAULT_PREDICTION_PREFERENCES;
  }
}

export function serializePredictionPreferences(
  value: PredictionPreferences,
): string {
  return JSON.stringify({ ...value, version: 1 });
}

export function mergePredictionPreferences(
  base: PredictionPreferences,
  patch: PredictionPreferencePatch,
): PredictionPreferences {
  const style =
    patch.style !== undefined && STYLES.includes(patch.style)
      ? patch.style
      : base.style;
  return { style };
}

export function composePredictionSettingsView(
  preferences: PredictionPreferences,
): PredictionSettingsView {
  return {
    preferences,
    disclosure:
      "Style is saved with the desktop-compatible predictions preference. It applies when the mobile predictions widget lands.",
  };
}

export function defaultPredictionSettingsView(): PredictionSettingsView {
  return composePredictionSettingsView(DEFAULT_PREDICTION_PREFERENCES);
}
