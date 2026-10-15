import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import { createChatInteractions } from "../domain/chat-interactions";
import { createPlatformChatCommands } from "../adapters/platform-chat-commands";
import { createProviderEmoteReader } from "../adapters/provider-emotes";
import { createProviderCosmeticsReader } from "../adapters/provider-cosmetics";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@mobile/features/settings/domain/chat-display-preferences";
import { createRecordedChatReader } from "../adapters/recorded-chat-reader";
import { createWatchChatSession } from "../adapters/create-watch-chat-session";
import type { ChatDisplaySettingsSession } from "@mobile/features/settings/capabilities/chat-display-settings";
import type { DiscoverySession } from "@mobile/features/discovery/capabilities/platform-reads";
import type { ChannelIdentity } from "@streamfusion/core/platform";
import type { ChatPresentation } from "../capabilities/chat-presentation";

export function createChatRuntime(input: {
  readonly access: AuthenticatedPlatformAccess;
  readonly fetch: typeof globalThis.fetch;
  readonly openUrl: (url: string) => Promise<void>;
  readonly display?: ChatDisplaySettingsSession;
  readonly discovery: Pick<DiscoverySession, "readChannel">;
  readonly copyText: (text: string) => Promise<void>;
}) {
  const presentation: ChatPresentation = {
    copyText: input.copyText,
    async readChannel(identity: ChannelIdentity, signal: AbortSignal) {
      const page = await input.discovery.readChannel({
        channel: identity,
        signal,
      });
      if (!page.channel) return null;
      return {
        ...page.channel,
        isLive:
          page.status === "complete" &&
          !(page.cache.kind === "hit" && page.cache.stale) &&
          page.channel.isLive,
      };
    },
    viewChannel(channel: ChannelIdentity) {
      void input.openUrl(
        channel.platform === "twitch"
          ? `https://www.twitch.tv/${encodeURIComponent(channel.username)}`
          : `https://kick.com/${encodeURIComponent(channel.username)}`,
      );
    },
  };
  return {
    presentation,
    chat: createWatchChatSession({
      fetch: input.fetch,
      replayReader: createRecordedChatReader(input.fetch),
      messageLimit: () => input.display?.peek().preferences.messageLimit ?? 100,
      eventPreferences: () =>
        input.display?.peek().preferences ?? DEFAULT_CHAT_DISPLAY_PREFERENCES,
    }),
    interactions: createChatInteractions(
      createPlatformChatCommands(input),
      createProviderEmoteReader(input),
      input.display,
      createProviderCosmeticsReader(input),
    ),
  };
}
