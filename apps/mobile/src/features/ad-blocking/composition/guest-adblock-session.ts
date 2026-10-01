import type { Platform } from "@streamfusion/core/platform";
import type { EffectiveCapabilityPolicyReader } from "@mobile/features/installation-policy/capabilities/installation-policy";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import {
  AD_BLOCKING_COMPATIBILITY_CAPABILITY,
  type AdBlockPreferences,
  type AdBlockSession,
  type AdBlockView,
} from "../capabilities/ad-blocking";
import {
  composeAdBlockView,
  parseAdBlockPreferences,
  playbackFilterRequest,
} from "../domain/adblock-policy";
import { createAdBlockPreferenceStore } from "../data/adblock-preference-store";
import { createTwitchPlaylistProxyStore } from "../data/twitch-playlist-proxy-store";
import { parseTwitchPlaylistProxyPreferences } from "../domain/twitch-playlist-proxy-preferences";

export function createAdBlockSession(input: {
  readonly now?: () => number;
  readonly policy: EffectiveCapabilityPolicyReader;
  readonly settings: ProductSettingsStore;
  readonly runtimeSupported?: boolean;
}): AdBlockSession {
  const preferences = createAdBlockPreferenceStore({
    ...(input.now === undefined ? {} : { now: input.now }),
    settings: input.settings,
  });
  const playlistProxy = createTwitchPlaylistProxyStore({
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
      ...(input.runtimeSupported === undefined
        ? {}
        : { runtimeSupported: input.runtimeSupported }),
    });
  }

  return {
    async effective(platform: Platform) {
      return playbackFilterRequest(platform, await snapshot());
    },
    load: snapshot,
    async save(next: AdBlockPreferences) {
      const wasEnabled = (await snapshot()).enabled;
      await preferences.write(next);
      const saved = await snapshot();
      if (wasEnabled || saved.enabled) {
        const proxy = parseTwitchPlaylistProxyPreferences(
          await playlistProxy.read(),
        );
        if (proxy.enabled)
          await playlistProxy.write({ ...proxy, enabled: false });
      }
      return saved;
    },
  };
}
