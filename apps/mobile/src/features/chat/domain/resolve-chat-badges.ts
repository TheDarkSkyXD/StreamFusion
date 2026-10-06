import type { WatchChatBadgeCatalog } from "../capabilities/chat-badge-catalog";
import type { WatchChatBadge } from "../capabilities/watch-chat";

export function resolveWatchChatBadges(
  badges: readonly WatchChatBadge[],
  catalog: WatchChatBadgeCatalog,
  fallback: readonly WatchChatBadge[] = badges,
): readonly WatchChatBadge[] {
  return badges.map((badge, index) => {
    const channelBadge = catalog.get(badge.setId)?.get(badge.version);
    if (channelBadge) return channelBadge;
    const globalBadge = fallback[index];
    return globalBadge?.imageUrl ? globalBadge : badge;
  });
}
