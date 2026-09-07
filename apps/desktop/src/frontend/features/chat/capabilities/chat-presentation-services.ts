import type { ChatCosmeticBadge, ChatCosmeticProvider } from "@shared/chat-types";

export interface ChatBadgeAssignment {
  userId: string;
  badge: ChatCosmeticBadge;
}

export interface ChatRoleBadges {
  moderator?: ChatCosmeticBadge;
  vip?: ChatCosmeticBadge;
}

export interface ChatPresentationServices {
  getGlobalBadges(
    provider: Exclude<ChatCosmeticProvider, "7tv">,
    fallbackTitle: string
  ): Promise<ChatBadgeAssignment[]>;
  getChannelRoleBadges(
    channel: string,
    titles: { moderator: string; vip: string }
  ): Promise<ChatRoleBadges>;
  openExternal(url: string): Promise<void>;
}
