import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import { createChatInteractions } from "../domain/chat-interactions";
import { createPlatformChatCommands } from "../adapters/platform-chat-commands";
import { createProviderEmoteReader } from "../adapters/provider-emotes";
import { createRecordedChatReader } from "../adapters/recorded-chat-reader";
import { createWatchChatSession } from "../adapters/create-watch-chat-session";

export function createChatRuntime(input: {
  readonly access: AuthenticatedPlatformAccess;
  readonly fetch: typeof globalThis.fetch;
  readonly openUrl: (url: string) => Promise<void>;
}) {
  return {
    chat: createWatchChatSession({
      fetch: input.fetch,
      replayReader: createRecordedChatReader(input.fetch),
    }),
    interactions: createChatInteractions(
      createPlatformChatCommands(input),
      createProviderEmoteReader(input),
    ),
  };
}
