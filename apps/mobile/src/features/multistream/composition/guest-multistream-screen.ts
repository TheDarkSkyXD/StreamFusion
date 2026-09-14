import type { AndroidPlaybackContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type { VerifiedPolicyStore } from "@mobile/features/installation-policy/capabilities/installation-policy";
import { createEffectiveCapabilityPolicyReader } from "@mobile/features/installation-policy/domain/effective-capability-policy-reader";
import { createAndroidFocusedPlaybackPort } from "@mobile/features/watch/adapters/android/android-focused-playback";
import { AndroidMedia3PlayerSurface } from "@mobile/features/watch/adapters/android/android-media3-player-surface";
import { createKickLivePlaybackSource } from "@mobile/features/watch/adapters/kick/kick-live-playback-source";
import { createPlaybackCompatibilityPolicy } from "@mobile/features/watch/adapters/playback-compatibility-policy";
import { createTwitchLivePlaybackSource } from "@mobile/features/watch/adapters/twitch/twitch-live-playback-source";
import type { PlayerSurfaceProps } from "@mobile/features/watch/components/watch-screen";
import type { ComponentType } from "react";

import type { MultistreamRepository } from "../capabilities/multistream";
import { createMultistreamPlayback, type MultistreamPlayback } from "../domain/multistream-playback";

export type GuestMultistreamRuntime = {
  readonly PlayerSurface: ComponentType<PlayerSurfaceProps>;
  readonly playback: MultistreamPlayback;
  readonly repository: MultistreamRepository;
};

export function createGuestMultistreamScreen(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly nowEpochMs?: () => number;
  readonly playback: AndroidPlaybackContractPort;
  readonly policyStore: VerifiedPolicyStore;
  readonly repository: MultistreamRepository;
}): GuestMultistreamRuntime {
  return {
    PlayerSurface: AndroidMedia3PlayerSurface,
    playback: createMultistreamPlayback({
      playback: createAndroidFocusedPlaybackPort(input.playback),
      policy: createPlaybackCompatibilityPolicy(
        createEffectiveCapabilityPolicyReader({
          nowEpochMs: input.nowEpochMs ?? Date.now,
          store: input.policyStore,
        }),
      ),
      sources: {
        kick: createKickLivePlaybackSource({ fetch: input.fetch }),
        twitch: createTwitchLivePlaybackSource({ fetch: input.fetch }),
      },
    }),
    repository: input.repository,
  };
}
