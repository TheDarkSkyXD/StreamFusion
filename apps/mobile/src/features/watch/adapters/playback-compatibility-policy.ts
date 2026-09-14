import type { EffectiveCapabilityPolicyReader } from "@mobile/features/installation-policy/capabilities/installation-policy";
import type { Platform } from "@streamfusion/core/platform";

import type {
  PlaybackCompatibilityDecision,
  PlaybackCompatibilityPolicy,
} from "../capabilities/watch";
import { PLAYBACK_COMPATIBILITY_CAPABILITY } from "../capabilities/watch";

export function createPlaybackCompatibilityPolicy(
  reader: EffectiveCapabilityPolicyReader,
): PlaybackCompatibilityPolicy {
  return {
    async read(platform: Platform): Promise<PlaybackCompatibilityDecision> {
      const decision = await reader.read(
        PLAYBACK_COMPATIBILITY_CAPABILITY[platform],
      );
      if (decision.kind === "enabled") {
        return { kind: "enabled", sequence: decision.sequence };
      }
      if (decision.reason === "no-valid-policy") {
        return { kind: "enabled", sequence: 0 };
      }
      return decision;
    },
  };
}
