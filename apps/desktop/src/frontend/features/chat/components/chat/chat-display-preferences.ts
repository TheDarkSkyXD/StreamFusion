import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
} from "../../../../../shared/auth-types";

/**
 * Complete a persisted chat-display snapshot before behavior reads it.
 * Older installs can legitimately have only the fields that existed when
 * their preferences were saved.
 */
export function resolveChatDisplayPreferences(
  stored: Partial<ChatDisplayPreferences> | null | undefined
): ChatDisplayPreferences {
  return { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, ...(stored ?? {}) };
}
