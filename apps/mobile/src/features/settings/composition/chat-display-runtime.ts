import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import type {
  ChatDisplayPreferencePatch,
  ChatDisplayPreferences,
  ChatDisplaySettingsSession,
  ChatDisplaySettingsView,
} from "../capabilities/chat-display-settings";
import { createChatDisplayStore } from "../data/chat-display-store";
import {
  composeChatDisplaySettingsView,
  defaultChatDisplaySettingsView,
  mergeChatDisplayPreferences,
  parseChatDisplayPreferences,
} from "../domain/chat-display-preferences";

export function createChatDisplaySettingsSession(input: {
  readonly now?: () => number;
  readonly settings: ProductSettingsStore;
}): ChatDisplaySettingsSession {
  const store = createChatDisplayStore({
    ...(input.now === undefined ? {} : { now: input.now }),
    settings: input.settings,
  });
  const listeners = new Set<() => void>();
  let cached = defaultChatDisplaySettingsView();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  async function hydrate(): Promise<ChatDisplaySettingsView> {
    cached = composeChatDisplaySettingsView(
      parseChatDisplayPreferences(await store.read()),
    );
    notify();
    return cached;
  }

  return {
    peek: () => cached,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: () => hydrate(),
    async apply(patch: ChatDisplayPreferencePatch) {
      const next = mergeChatDisplayPreferences(cached.preferences, patch);
      await store.write(next);
      return hydrate();
    },
    async snapshot(): Promise<ChatDisplayPreferences> {
      return parseChatDisplayPreferences(await store.read());
    },
  };
}
