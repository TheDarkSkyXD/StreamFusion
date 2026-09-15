import type { Platform } from "@streamfusion/core/platform";

export const AD_BLOCKING_SETTING_KEY = "adblock.v1";
export const AD_BLOCKING_COMPATIBILITY_CAPABILITY =
  "compat.playback.ad-blocking";

export type AdBlockMethod = "strip" | "canary";

export type PlaybackFilterMode = "passthrough" | "canary" | "strip";

export type AdBlockPreferences = {
  readonly enabled: boolean;
  readonly method: AdBlockMethod;
};

export type PlaybackFilterRequest = {
  readonly enabled: boolean;
  readonly mode: PlaybackFilterMode;
  readonly platform: Platform;
};

export type PlaylistFilterResult = {
  readonly adsDetected: boolean;
  readonly applied: boolean;
  readonly diagnostic: string;
  readonly playlist: string;
};

export type AdBlockView = {
  readonly canary: boolean;
  readonly detail: string;
  readonly enabled: boolean;
  readonly kickSupported: false;
  readonly method: AdBlockMethod;
  readonly policyAllowed: boolean;
  readonly title: string;
  readonly twitchSupported: true;
};

export type PlaybackFiltering = {
  effective(platform: Platform): Promise<PlaybackFilterRequest>;
};

export interface AdBlockSession extends PlaybackFiltering {
  load(): Promise<AdBlockView>;
  save(next: AdBlockPreferences): Promise<AdBlockView>;
}
