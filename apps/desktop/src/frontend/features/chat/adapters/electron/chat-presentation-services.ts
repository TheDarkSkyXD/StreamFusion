import { unwrapIpcReply } from "@/lib/ipc-reply";
import type { ChatCosmeticBadge } from "@shared/chat-types";
import type { ChatPresentationServices } from "../../capabilities/chat-presentation-services";

function normalizeCosmeticUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

const desktopChatPresentationServices: ChatPresentationServices = {
  async getGlobalBadges(provider, fallbackTitle) {
    if (provider === "bttv") {
      const catalog = unwrapIpcReply(await window.electronAPI.emotes.bttv.getBadges());
      return catalog.map((entry) => ({
        userId: entry.providerId,
        badge: {
          id: `bttv:${entry.providerId}`,
          provider: "bttv",
          providerId: entry.providerId,
          title: entry.badge.description || fallbackTitle,
          imageUrl: normalizeCosmeticUrl(entry.badge.svg),
        },
      }));
    }

    const catalog = unwrapIpcReply(await window.electronAPI.emotes.ffz.getBadges());
    const definitions = new Map(catalog.badges.map((badge) => [String(badge.id), badge]));
    return Object.entries(catalog.users).flatMap(([badgeId, userIds]) => {
      const badge = definitions.get(badgeId);
      if (!badge) return [];
      return userIds.map((userId) => ({
        userId: String(userId),
        badge: {
          id: `ffz:${badgeId}`,
          provider: "ffz" as const,
          providerId: badgeId,
          title: badge.title || fallbackTitle,
          imageUrl: normalizeCosmeticUrl(badge.urls["4"] ?? badge.urls["2"] ?? badge.urls["1"]),
          slot: badge.slot,
          replaces: badge.replaces,
          color: badge.color,
        },
      }));
    });
  },
  async getChannelRoleBadges(channel, titles) {
    const room = unwrapIpcReply(
      await window.electronAPI.emotes.ffz.getRoom({ kind: "name", name: channel })
    );
    const roleBadge = (
      role: "moderator" | "vip",
      urls?: { "1": string; "2"?: string; "4"?: string } | null
    ): ChatCosmeticBadge | undefined =>
      urls
        ? {
            id: `ffz:room-${role}`,
            provider: "ffz",
            providerId: `room-${role}`,
            title: titles[role],
            imageUrl: normalizeCosmeticUrl(urls["4"] ?? urls["2"] ?? urls["1"]),
          }
        : undefined;
    return {
      moderator: roleBadge("moderator", room?.room.mod_urls),
      vip: roleBadge("vip", room?.room.vip_badge),
    };
  },
  openExternal: (url) => window.electronAPI.openExternal(url),
};

export function getDesktopChatPresentationServices(): ChatPresentationServices | undefined {
  return window.electronAPI ? desktopChatPresentationServices : undefined;
}
