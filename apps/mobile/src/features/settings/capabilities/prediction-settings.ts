/** Desktop-compatible prediction widget preferences (`predictions`). */

export type PredictionStyle = "native" | "unified";

export type PredictionPreferences = {
  readonly style: PredictionStyle;
};

export type PredictionPreferencePatch = Partial<PredictionPreferences>;

export type PredictionSettingsView = {
  readonly preferences: PredictionPreferences;
  readonly disclosure: string;
};

export type PredictionSettingsSession = {
  apply(patch: PredictionPreferencePatch): Promise<PredictionSettingsView>;
  load(): Promise<PredictionSettingsView>;
  peek(): PredictionSettingsView;
  snapshot(): Promise<PredictionPreferences>;
  subscribe(listener: () => void): () => void;
};

export const PREDICTION_SETTING_KEY = "predictions.v1";

export function serializePredictionPreferences(
  value: PredictionPreferences,
): string {
  return JSON.stringify({ ...value, version: 1 });
}
