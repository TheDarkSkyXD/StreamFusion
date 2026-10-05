import type { ComponentType } from "react";
import type { DiscoverySession } from "@mobile/features/discovery/capabilities/platform-reads";
import type { VerifiedPolicyStore } from "@mobile/features/installation-policy/capabilities/installation-policy";
import { createEffectiveCapabilityPolicyReader } from "@mobile/features/installation-policy/domain/effective-capability-policy-reader";
import type {
  AndroidPlaybackContractPort,
  AndroidDiagnosticsContractPort,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import type {
  WatchRuntime,
  WatchSessionIdSource,
} from "@mobile/features/watch/capabilities/watch";
import { createAndroidFocusedPlaybackPort } from "@mobile/features/watch/adapters/android/android-focused-playback";
import { AndroidMedia3PlayerSurface } from "@mobile/features/watch/adapters/android/android-media3-player-surface";
import { createExpoHlsFocusedPlaybackPort } from "@mobile/features/watch/adapters/expo/expo-hls-focused-playback";
import { ExpoHlsPlayerSurface } from "@mobile/features/watch/adapters/expo/expo-hls-player-surface";
import { createPlaybackCompatibilityPolicy } from "@mobile/features/watch/adapters/playback-compatibility-policy";
import { createDiscoveryMultistreamChannels } from "../adapters/discovery-multistream-channels";
import { createAndroidMultistreamAdmission } from "../adapters/android-resource-admission";
import { createMultistreamSession } from "../domain/multistream-session";
import type { MultistreamSession } from "../capabilities/multistream";
import type { MultistreamChat } from "../capabilities/multistream-chat";
import { createMultistreamChat } from "../domain/multistream-chat";
import { createWatchChatSession } from "@mobile/features/chat/adapters/create-watch-chat-session";
import { createChatInteractions } from "@mobile/features/chat/domain/chat-interactions";
import { createPlatformChatCommands } from "@mobile/features/chat/adapters/platform-chat-commands";
import { createProviderEmoteReader } from "@mobile/features/chat/adapters/provider-emotes";
import type { ChatInteractions } from "@mobile/features/chat/capabilities/chat-interactions";
import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";

export type MultistreamRuntime = {
  readonly session: MultistreamSession;
  readonly chat: MultistreamChat;
  readonly interactions: ChatInteractions;
  readonly PlayerSurface: ComponentType<{
    readonly sessionId: string;
    readonly testID?: string;
  }>;
};
export function createMultistreamRuntime(input: {
  readonly discovery: DiscoverySession;
  readonly access: AuthenticatedPlatformAccess;
  readonly fetch: typeof globalThis.fetch;
  readonly openUrl: (url: string) => Promise<void>;
  readonly playback: AndroidPlaybackContractPort;
  readonly diagnostics: AndroidDiagnosticsContractPort;
  readonly policyStore: VerifiedPolicyStore;
  readonly watch: WatchRuntime;
  readonly sessionIds: WatchSessionIdSource;
  readonly limit: () => number;
}): MultistreamRuntime {
  const native = input.playback.readiness().kind === "ready";
  return {
    chat: createMultistreamChat(() =>
      createWatchChatSession({ fetch: input.fetch }),
    ),
    interactions: createChatInteractions(
      createPlatformChatCommands(input),
      createProviderEmoteReader(input),
    ),
    PlayerSurface: native ? AndroidMedia3PlayerSurface : ExpoHlsPlayerSurface,
    session: createMultistreamSession({
      channels: createDiscoveryMultistreamChannels(input.discovery),
      playback: native
        ? createAndroidFocusedPlaybackPort(input.playback)
        : createExpoHlsFocusedPlaybackPort(),
      policy: createPlaybackCompatibilityPolicy(
        createEffectiveCapabilityPolicyReader({
          nowEpochMs: Date.now,
          store: input.policyStore,
        }),
      ),
      resolve: input.watch.resolveSource,
      sessionIds: input.sessionIds,
      limit: input.limit,
      beforeStart: () => input.watch.session.dismiss(),
      admission: createAndroidMultistreamAdmission(input.diagnostics),
    }),
  };
}
