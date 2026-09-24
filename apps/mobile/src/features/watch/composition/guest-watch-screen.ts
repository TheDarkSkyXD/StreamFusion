import type { AdBlockSession } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { TwitchPlaylistProxySession } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";
import type { SettingsSession } from "@mobile/features/settings/capabilities/settings";
import { playbackSessionPolicy } from "@mobile/features/settings/domain/settings-view";
import type { WatchHistoryRepository } from "@mobile/features/media-library/capabilities/watch-history";
import type { DiscoverySession } from "@mobile/features/discovery/capabilities/platform-reads";
import { createEffectiveCapabilityPolicyReader } from "@mobile/features/installation-policy/domain/effective-capability-policy-reader";
import type { VerifiedPolicyStore } from "@mobile/features/installation-policy/capabilities/installation-policy";
import type { AndroidPlaybackContractPort } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";

import { createAndroidFocusedPlaybackPort } from "../adapters/android/android-focused-playback";
import { AndroidMedia3PlayerSurface } from "../adapters/android/android-media3-player-surface";
import { createDiscoveryWatchInspectionReader } from "../adapters/discovery-watch-inspection-reader";
import { createMemoryPlaybackProtection } from "../adapters/focused-playback-protection";
import { createKickLivePlaybackSource } from "../adapters/kick/kick-live-playback-source";
import { createKickVideoPlaybackSource } from "../adapters/kick/kick-vod-playback-source";
import { createPlaybackCompatibilityPolicy } from "../adapters/playback-compatibility-policy";
import { createTwitchClipPlaybackSource } from "../adapters/twitch/twitch-clip-playback-source";
import { createTwitchLivePlaybackSource } from "../adapters/twitch/twitch-live-playback-source";
import { createTwitchVodPlaybackSource } from "../adapters/twitch/twitch-vod-playback-source";
import { createExpoWatchProviderFallback } from "../adapters/expo-watch-provider-fallback";
import { createWatchChatSession } from "@mobile/features/chat/adapters/create-watch-chat-session";
import type { WatchScreenRuntime } from "../components/watch-screen";
import type { WatchSessionIdSource } from "../capabilities/watch";
import { createWatchRuntime } from "./watch-runtime";

export function createGuestWatchScreen(input: {
  readonly discovery: DiscoverySession;
  readonly fetch: typeof globalThis.fetch;
  readonly filtering?: AdBlockSession;
  readonly history: WatchHistoryRepository;
  readonly nowEpochMs?: () => number;
  readonly playback: AndroidPlaybackContractPort;
  readonly playbackSettings?: SettingsSession;
  readonly playlistProxy?: TwitchPlaylistProxySession;
  readonly policyStore: VerifiedPolicyStore;
  readonly sessionIds: WatchSessionIdSource;
}): WatchScreenRuntime {
  const filtering = input.filtering;
  const playbackSettings = input.playbackSettings;
  const playlistProxy = input.playlistProxy;
  return {
    ...(filtering === undefined ? {} : { adblock: filtering }),
    ...(playlistProxy === undefined ? {} : { playlistProxy }),
    chat: createWatchChatSession({ fetch: input.fetch }),
    history: input.history,
    openProviderPage: createExpoWatchProviderFallback(),
    PlayerSurface: AndroidMedia3PlayerSurface,
    runtime: createWatchRuntime({
      ...(filtering === undefined ? {} : { filtering }),
      ...(playbackSettings === undefined
        ? {}
        : {
            playbackSettings: {
              snapshot: () => playbackSessionPolicy(playbackSettings.snapshot()),
            },
          }),
      ...(playlistProxy === undefined ? {} : { playlistProxy }),
      inspection: createDiscoveryWatchInspectionReader(input.discovery),
      playback: createAndroidFocusedPlaybackPort(input.playback),
      policy: createPlaybackCompatibilityPolicy(
        createEffectiveCapabilityPolicyReader({
          nowEpochMs: input.nowEpochMs ?? Date.now,
          store: input.policyStore,
        }),
      ),
      protection: createMemoryPlaybackProtection(),
      sessionIds: input.sessionIds,
      recorded: {
        kickVideo: createKickVideoPlaybackSource({ fetch: input.fetch }),
        twitchClip: createTwitchClipPlaybackSource({ fetch: input.fetch }),
        twitchVideo: createTwitchVodPlaybackSource({ fetch: input.fetch }),
      },
      sources: {
        kick: createKickLivePlaybackSource({ fetch: input.fetch }),
        twitch: createTwitchLivePlaybackSource({ fetch: input.fetch }),
      },
    }),
  };
}
