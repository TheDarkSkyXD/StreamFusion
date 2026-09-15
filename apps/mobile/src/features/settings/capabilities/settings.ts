import type {
  PreferenceApplyResult,
  PreferencePatch,
  ProductPreferences,
  SettingsControlCatalogEntry,
  SettingsPanelId,
} from "@streamfusion/core/settings";

export const PRODUCT_SETTINGS_KEY = "product-settings.v1";

export type SettingsEffectiveCopy = {
  readonly backgroundQuality: string;
  readonly buffer: string;
  readonly captions: string;
  readonly carousel: string;
  readonly hevc: string;
  readonly language: string;
  readonly multiviewCap: string;
  readonly playerChrome: string;
  readonly restoreSession: string;
  readonly resumePlayback: string;
  readonly theme: string;
  readonly tokenPlayer: string;
};

export type SettingsView = {
  readonly effective: SettingsEffectiveCopy;
  readonly matches: readonly SettingsControlCatalogEntry[];
  readonly panels: readonly SettingsPanelId[];
  readonly preferences: ProductPreferences;
  readonly query: string;
  readonly rejected: readonly string[];
  readonly streamDeviceId: string;
};

export type PlaybackSessionPolicy = {
  readonly allowHevc: boolean;
  readonly backgroundQuality: ProductPreferences["backgroundQuality"];
  readonly captionsEnabled: boolean;
  readonly forwardBufferSec: number;
  readonly liveSyncDurationCount: number;
  readonly lowLatencyMode: boolean;
  readonly maxBufferSec: number;
  readonly quality: ProductPreferences["quality"];
};

export interface SettingsSession {
  apply(patch: PreferencePatch): Promise<PreferenceApplyResult>;
  load(): Promise<SettingsView>;
  peek(): SettingsView;
  read(): Promise<ProductPreferences>;
  search(query: string): Promise<SettingsView>;
  snapshot(): ProductPreferences;
  subscribe(listener: () => void): () => void;
}
