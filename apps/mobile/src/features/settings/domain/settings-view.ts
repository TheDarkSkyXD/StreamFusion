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
  const matches = searchSettingsControls(query);
  return {
    effective: composeEffectiveCopy(input.preferences),
    matches,
    panels: settingsPanelsFor(matches),
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
  const language = getDisplayLanguage(resolveDisplayLanguage(preferences.language));
  const languageLabel =
    language.nativeLabel === language.englishLabel
      ? language.nativeLabel
      : `${language.nativeLabel} (${language.englishLabel})`;
  return {
    backgroundQuality: `Unfocused Multistream slots request ${preferences.backgroundQuality} when thermal or decoder pressure lowers quality.`,
    buffer:
      "Android maps these knobs to ExoPlayer LoadControl and live target offset. HLS.js buffer counts stay desktop-only.",
    captions: enabledCopy(
      preferences.captionsEnabled,
      "Watch can start local captions. Audio stays on this device.",
      "Local captions stay hidden until this toggle is on.",
    ),
    carousel:
      "Home carousel is not on this build. The interval is saved for when it ships.",
    hevc: enabledCopy(
      preferences.allowHevc,
      "HEVC is preferred when the device decoder supports it.",
      "Playback prefers H.264 over HEVC.",
    ),
    language: `Interface language: ${languageLabel}.`,
    theme:
      "Dark mode is the only appearance on this build. Light and system themes stay desktop-only until mobile light tokens ship.",
    multiviewCap: `Configured cap is ${preferences.multiviewCap}. Measured active video can be lower.`,
    playerChrome:
      "Speed, theater, and video stats stay unavailable until those capabilities ship. Hidden controls stay off Watch chrome.",
    restoreSession: enabledCopy(
      preferences.restoreSession,
      "Prior More, Watch, and Multistream routes restore after relaunch. Watch still waits for Start watching.",
      "Startup opens Home. Saved routes stay unused until restore is on.",
    ),
    resumePlayback:
      "Watch never autoplays after restore. Start watching stays explicit.",
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
