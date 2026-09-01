import type { ChatPlatform } from "../../../../../shared/chat-types";
import { buildChannelKey, useChatStore } from "../../../../store/chat-store";
import { getMentionRange, type MentionRange } from "../../utils/mention-completion";

export interface RecentChatter {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly color?: string;
  readonly avatarUrl?: string;
  readonly lastSeen: Date;
}

export function getMentionSuggestions({
  inputValue,
  cursorPosition,
  platform,
  channel,
  minChars = 0,
}: {
  readonly inputValue: string;
  readonly cursorPosition: number;
  readonly platform: ChatPlatform;
  readonly channel: string;
  readonly minChars?: number;
}): { readonly match: MentionRange | null; readonly suggestions: readonly RecentChatter[] } {
  const match = getMentionRange(inputValue, cursorPosition);
  if (!match || match.query.length < minChars) return { match: null, suggestions: [] };

  const channelKey = buildChannelKey(platform, channel);
  const state = useChatStore.getState();
  const usersByUsername = new Map<string, RecentChatter>();
  const knownUsers = state.usersByChannel[channelKey] ?? {};
  for (const user of Object.values(knownUsers)) {
    usersByUsername.set(user.username.toLowerCase(), {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      color: user.color,
      avatarUrl: user.avatarUrl,
      lastSeen: user.lastSeen,
    });
  }

  const chatters = new Map<string, RecentChatter>();
  const messages = state.messagesByChannel[channelKey] ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type !== "message") continue;
    const key = message.username.toLowerCase();
    if (chatters.has(key)) continue;
    const known = usersByUsername.get(key);
    chatters.set(key, {
      userId: message.userId,
      username: message.username,
      displayName: message.displayName,
      color: message.color || known?.color,
      avatarUrl: message.avatarUrl || known?.avatarUrl,
      lastSeen: message.timestamp,
    });
  }
  for (const [key, user] of usersByUsername) {
    if (!chatters.has(key)) chatters.set(key, user);
  }

  const query = match.query.toLowerCase();
  const suggestions = Array.from(chatters.values())
    .filter(
      (chatter) =>
        chatter.username.toLowerCase().includes(query) ||
        chatter.displayName.toLowerCase().includes(query)
    )
    .sort((left, right) => {
      const leftMatchesPrefix =
        left.username.toLowerCase().startsWith(query) ||
        left.displayName.toLowerCase().startsWith(query);
      const rightMatchesPrefix =
        right.username.toLowerCase().startsWith(query) ||
        right.displayName.toLowerCase().startsWith(query);
      if (leftMatchesPrefix !== rightMatchesPrefix) return leftMatchesPrefix ? -1 : 1;
      return right.lastSeen.getTime() - left.lastSeen.getTime();
    });

  return { match, suggestions };
}
