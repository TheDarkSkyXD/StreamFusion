import type { Platform } from "@streamfusion/core/platform";
import type { EffectiveCapabilityPolicyReader } from "@mobile/features/installation-policy/capabilities/installation-policy";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import {
  AD_BLOCKING_COMPATIBILITY_CAPABILITY,
  type AdBlockPreferences,
  type AdBlockSession,
  type AdBlockView,
} from "../capabilities/ad-blocking";
import type { TwitchPlaylistProxyPreferences } from "../capabilities/twitch-playlist-proxy";
import {
  composeAdBlockView,
  parseAdBlockPreferences,
  playbackFilterRequest,
} from "../domain/adblock-policy";
import { createAdBlockPreferenceStore } from "../data/adblock-preference-store";
import { isTwitchPlaylistProxyMode } from "../domain/twitch-playlist-proxy";

export function createAdBlockSession(input: {
  readonly now?: () => number;
  readonly playlistProxy?: {
    snapshot(): Promise<TwitchPlaylistProxyPreferences>;
  };
  readonly policy: EffectiveCapabilityPolicyReader;
  readonly settings: ProductSettingsStore;
}): AdBlockSession {
  const preferences = createAdBlockPreferenceStore({
    ...(input.now === undefined ? {} : { now: input.now }),
    settings: input.settings,
  });

  async function snapshot(): Promise<AdBlockView> {
    const [raw, decision] = await Promise.all([
      preferences.read(),
      input.policy.read(AD_BLOCKING_COMPATIBILITY_CAPABILITY),
    ]);
    const policyAllowed =
      decision.kind === "enabled" || decision.reason === "no-valid-policy";
    return composeAdBlockView({
      policyAllowed,
      preferences: parseAdBlockPreferences(raw),
    });
  }

  async function playlistProxyEnabled(): Promise<boolean> {
    if (!input.playlistProxy) return false;
    const prefs = await input.playlistProxy.snapshot();
    return isTwitchPlaylistProxyMode({ twitchPlaylistProxy: prefs });
  }

  return {
    async effective(platform: Platform) {
      const view = await snapshot();
      if (await playlistProxyEnabled()) {
        return {
          enabled: false,
          mode: "passthrough",
          platform,
        };
      }
      return playbackFilterRequest(platform, view);
    },
    load: snapshot,
    async save(next: AdBlockPreferences) {
      await preferences.write(next);
      return snapshot();
    },
  };
}
