import type { Platform } from "@streamfusion/core/platform";

import type {
  AdBlockMethod,
  AdBlockPreferences,
  AdBlockView,
  PlaybackFilterMode,
  PlaybackFilterRequest,
} from "../capabilities/ad-blocking";

export const DEFAULT_AD_BLOCK_PREFERENCES: AdBlockPreferences = {
  enabled: true,
  method: "strip",
};

export function parseAdBlockPreferences(raw: string | null): AdBlockPreferences {
  if (!raw) return DEFAULT_AD_BLOCK_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<AdBlockPreferences>;
    return {
      enabled: parsed.enabled !== false,
      method: parsed.method === "canary" ? "canary" : "strip",
    };
  } catch {
    return DEFAULT_AD_BLOCK_PREFERENCES;
  }
}

export function composeAdBlockView(input: {
  readonly policyAllowed: boolean;
  readonly preferences: AdBlockPreferences;
}): AdBlockView {
  const enabled = input.policyAllowed && input.preferences.enabled;
  return {
    canary: input.preferences.method === "canary",
    detail: detailFor(input.policyAllowed, input.preferences),
    enabled,
    kickSupported: false,
    method: input.preferences.method,
    policyAllowed: input.policyAllowed,
    title: titleFor(enabled, input.preferences.method),
    twitchSupported: true,
  };
}

export function playbackFilterRequest(
  platform: Platform,
  view: AdBlockView,
): PlaybackFilterRequest {
  return {
    enabled: view.enabled,
    mode: filterMode(platform, view),
    platform,
  };
}

function filterMode(platform: Platform, view: AdBlockView): PlaybackFilterMode {
  if (!view.enabled || !view.policyAllowed || platform !== "twitch") {
    return "passthrough";
  }
  if (view.method === "canary") return "canary";
  return "strip";
}

function titleFor(enabled: boolean, method: AdBlockMethod): string {
  if (!enabled) return "Playback filtering off";
  if (method === "canary") return "Canary is watching Twitch ads";
  return "Twitch ads are filtered";
}

function detailFor(
  policyAllowed: boolean,
  preferences: AdBlockPreferences,
): string {
  if (!policyAllowed) {
    return "Signed policy disabled playback filtering. Watch still plays the original stream.";
  }
  if (!preferences.enabled) {
    return "Kill switch is off. Twitch and Kick play unfiltered playlists.";
  }
  if (preferences.method === "canary") {
    return "Canary reports Twitch ad markers without rewriting playlists. Kick has no approved filter.";
  }
  return "Twitch live playlists strip known ad markers in the player. Kick has no approved filter and stays unfiltered. Filter failure keeps the original playlist.";
}
