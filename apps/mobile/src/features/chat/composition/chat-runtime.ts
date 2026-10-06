import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import { createChatInteractions } from "../domain/chat-interactions";
import { createPlatformChatCommands } from "../adapters/platform-chat-commands";
import { createProviderEmoteReader } from "../adapters/provider-emotes";
import { createProviderCosmeticsReader } from "../adapters/provider-cosmetics";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@mobile/features/settings/domain/chat-display-preferences";
import { createRecordedChatReader } from "../adapters/recorded-chat-reader";
import { createWatchChatSession } from "../adapters/create-watch-chat-session";
import type { ChatDisplaySettingsSession } from "@mobile/features/settings/capabilities/chat-display-settings";

export function createChatRuntime(input: {
  readonly access: AuthenticatedPlatformAccess;
  readonly fetch: typeof globalThis.fetch;
  readonly openUrl: (url: string) => Promise<void>;
  readonly display?: ChatDisplaySettingsSession;
}) {
  return {
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
