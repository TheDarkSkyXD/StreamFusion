import {
  DEFAULT_PRODUCT_PREFERENCES,
  searchSettingsControls,
  settingsPanelsFor,
  type ProductPreferences,
} from "@streamfusion/core/settings";
import {
  getDisplayLanguage,
  resolveDisplayLanguage,
} from "@streamfusion/core/display-language";

import type {
  PlaybackSessionPolicy,
  SettingsEffectiveCopy,
  SettingsView,
} from "../capabilities/settings";

export function composeSettingsView(input: {
  readonly preferences: ProductPreferences;
  readonly query?: string;
  readonly rejected?: readonly string[];
  readonly streamDeviceId?: string;
}): SettingsView {
  const query = input.query ?? "";
  const matches = searchSettingsControls(query).filter(
    (match) => match.panel !== "multiview",
  );
  const panels = settingsPanelsFor(matches).filter(
    (panel) => panel !== "multiview",
  );
  return {
    effective: composeEffectiveCopy(input.preferences),
    matches,
    panels,
    preferences: input.preferences,
    query,
    rejected: input.rejected ?? [],
    streamDeviceId: input.streamDeviceId ?? "unavailable",
  };
}

export function playbackSessionPolicy(
  preferences: ProductPreferences,
): PlaybackSessionPolicy {
  return {
    allowHevc: preferences.allowHevc,
    backgroundQuality: preferences.backgroundQuality,
    captionsEnabled: preferences.captionsEnabled,
    forwardBufferSec: preferences.forwardBufferSec,
    liveSyncDurationCount: preferences.liveSyncDurationCount,
    lowLatencyMode: preferences.lowLatencyMode,
    maxBufferSec: preferences.maxBufferSec,
    quality: preferences.quality,
  };
}

export function composeEffectiveCopy(
  preferences: ProductPreferences,
): SettingsEffectiveCopy {
  const language = getDisplayLanguage(
    resolveDisplayLanguage(preferences.language),
  );
  // Prefer the self-named / native label so Appearance clearly shows the active language.
  const languageLabel = language.nativeLabel;
  return {
    backgroundQuality: `Background playback requests ${preferences.backgroundQuality} when thermal or decoder pressure lowers quality.`,
    buffer:
      "Android maps these knobs to ExoPlayer LoadControl and live target offset. HLS.js buffer counts stay desktop-only.",
    captions: enabledCopy(
      preferences.captionsEnabled,
      "Use Local captions in the player to install the English model and start captions.",
      "Use Local captions in the player to start captions.",
    ),
    carousel: "Choose how long each featured stream appears on Home.",
    hevc: enabledCopy(
      preferences.allowHevc,
      "HEVC is preferred when the device decoder supports it.",
      "Playback prefers H.264 over HEVC.",
    ),
    language: `Interface language: ${languageLabel}.`,
    theme:
      "Dark mode is available on mobile. Light and System are unavailable.",
    multiviewCap: `Configured cap is ${preferences.multiviewCap}. Measured active video can be lower.`,
    playerChrome:
      "Choose the player controls to display. Playback speed applies to videos and clips. Theater mode is unavailable on mobile.",
    restoreSession: enabledCopy(
      preferences.restoreSession,
      "Reopen your last screen. Playback starts when you select Start watching.",
      "Open Home when starting StreamFusion.",
    ),
    resumePlayback: "Playback starts when you select Start watching.",
    tokenPlayer: "Native ExoPlayer is the only eligible player.",
  };
}

export function defaultSettingsView(): SettingsView {
  return composeSettingsView({ preferences: DEFAULT_PRODUCT_PREFERENCES });
}

function enabledCopy(enabled: boolean, on: string, off: string): string {
  if (enabled) return on;
  return off;
}
