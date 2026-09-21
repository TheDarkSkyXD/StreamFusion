import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import {
  CHAT_DISPLAY_SETTING_KEY,
  type ChatDisplayPreferences,
} from "../capabilities/chat-display-settings";
import { serializeChatDisplayPreferences } from "../domain/chat-display-preferences";

export function createChatDisplayStore(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
}): {
  read(): Promise<string | null>;
  write(value: ChatDisplayPreferences): Promise<void>;
} {
  const now = input.now ?? Date.now;
  return {
    read() {
      return input.settings.read(CHAT_DISPLAY_SETTING_KEY);
    },
    write(value) {
      return input.settings.write(
        CHAT_DISPLAY_SETTING_KEY,
        serializeChatDisplayPreferences(value),
        now(),
      );
    },
  };
}
