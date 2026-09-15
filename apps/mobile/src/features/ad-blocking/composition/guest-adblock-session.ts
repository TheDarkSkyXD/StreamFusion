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

export function createAdBlockSession(input: {
  readonly now?: () => number;
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

  return {
    async effective(platform: Platform) {
      return playbackFilterRequest(platform, await snapshot());
    },
    load: snapshot,
    async save(next: AdBlockPreferences) {
      await preferences.write(next);
      return snapshot();
    },
  };
}
