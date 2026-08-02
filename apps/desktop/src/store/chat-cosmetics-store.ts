import type {
  ChatCosmeticBadge,
  ChatCosmeticProvider,
  ChatUserCosmetics,
  SevenTvPaint,
} from "@shared/chat-types";
import { create } from "zustand";
import type { SevenTvCosmeticEvent } from "@/backend/services/chat/seven-tv-cosmetics-client";

type GlobalBadgeProvider = Exclude<ChatCosmeticProvider, "7tv">;
type GlobalProviderLoadState = "loading" | "loaded";

export interface ChatCosmeticsState {
  badgeDefinitions: Map<string, ChatCosmeticBadge>;
  paintDefinitions: Map<string, SevenTvPaint>;
  globalUserBadgeAssignments: Map<string, string[]>;
  userBadgeAssignments: Map<string, string[]>;
  userPaintAssignments: Map<string, string>;
  ffzRoleBadges: Map<string, { moderator?: ChatCosmeticBadge; vip?: ChatCosmeticBadge }>;
  globalProviderLoadState: Map<GlobalBadgeProvider, GlobalProviderLoadState>;
  sevenTvChannelLeases: Map<string, number>;
  beginGlobalProviderLoad: (provider: GlobalBadgeProvider) => boolean;
  failGlobalProviderLoad: (provider: GlobalBadgeProvider) => void;
  setGlobalProviderBadges: (
    provider: GlobalBadgeProvider,
    assignments: Array<{ userId: string; badge: ChatCosmeticBadge }>
  ) => void;
  applySevenTvEvent: (channelId: string, event: SevenTvCosmeticEvent) => void;
  setFfzRoleBadges: (
    channelId: string,
    badges: { moderator?: ChatCosmeticBadge; vip?: ChatCosmeticBadge }
  ) => void;
  getUserCosmetics: (channelId: string, userId: string) => ChatUserCosmetics;
  acquireSevenTvChannel: (channelId: string) => void;
  releaseSevenTvChannel: (channelId: string) => void;
  reset: () => void;
}

const EMPTY_STATE = {
  badgeDefinitions: new Map<string, ChatCosmeticBadge>(),
  paintDefinitions: new Map<string, SevenTvPaint>(),
  globalUserBadgeAssignments: new Map<string, string[]>(),
  userBadgeAssignments: new Map<string, string[]>(),
  userPaintAssignments: new Map<string, string>(),
  ffzRoleBadges: new Map<string, { moderator?: ChatCosmeticBadge; vip?: ChatCosmeticBadge }>(),
  globalProviderLoadState: new Map<GlobalBadgeProvider, GlobalProviderLoadState>(),
  sevenTvChannelLeases: new Map<string, number>(),
};

export const useChatCosmeticsStore = create<ChatCosmeticsState>((set, get) => ({
  ...EMPTY_STATE,
  beginGlobalProviderLoad: (provider) => {
    if (get().globalProviderLoadState.has(provider)) return false;
    const loadState = new Map(get().globalProviderLoadState);
    loadState.set(provider, "loading");
    set({ globalProviderLoadState: loadState });
    return true;
  },
  failGlobalProviderLoad: (provider) => {
    if (get().globalProviderLoadState.get(provider) !== "loading") return;
    const loadState = new Map(get().globalProviderLoadState);
    loadState.delete(provider);
    set({ globalProviderLoadState: loadState });
  },
  setGlobalProviderBadges: (provider, incoming) => {
    const providerPrefix = `${provider}:`;
    const definitions = new Map(get().badgeDefinitions);
    for (const [id, badge] of definitions) {
      if (badge.provider === provider) definitions.delete(id);
    }
    const assignments = new Map(get().globalUserBadgeAssignments);
    for (const [userId, ids] of assignments) {
      const remaining = ids.filter((id) => !id.startsWith(providerPrefix));
      if (remaining.length > 0) assignments.set(userId, remaining);
      else assignments.delete(userId);
    }
    for (const { userId, badge } of incoming) {
      const id = `${provider}:${badge.providerId}`;
      definitions.set(id, { ...badge, id, provider });
      const current = assignments.get(userId) ?? [];
      if (!current.includes(id)) assignments.set(userId, [...current, id]);
    }
    const loadState = new Map(get().globalProviderLoadState);
    loadState.set(provider, "loaded");
    set({
      badgeDefinitions: definitions,
      globalUserBadgeAssignments: assignments,
      globalProviderLoadState: loadState,
    });
  },
  applySevenTvEvent: (channelId, event) => {
    if (event.type === "badge.upsert") {
      const definitions = new Map(get().badgeDefinitions);
      definitions.set(event.badge.id, event.badge);
      set({ badgeDefinitions: definitions });
      return;
    }
    if (event.type === "paint.upsert") {
      const definitions = new Map(get().paintDefinitions);
      definitions.set(event.paint.id, event.paint);
      set({ paintDefinitions: definitions });
      return;
    }
    const key = scopeKey(channelId, event.assignment.userId);
    if (event.assignment.kind === "paint") {
      const assignments = new Map(get().userPaintAssignments);
      if (event.type === "assignment.upsert") {
        assignments.set(key, event.assignment.cosmeticId);
      } else if (assignments.get(key) === event.assignment.cosmeticId) {
        assignments.delete(key);
      }
      set({ userPaintAssignments: assignments });
      return;
    }
    const assignments = new Map(get().userBadgeAssignments);
    const id = `7tv:${event.assignment.cosmeticId}`;
    const current = assignments.get(key) ?? [];
    if (event.type === "assignment.upsert") {
      assignments.set(key, [...current.filter((item) => !item.startsWith("7tv:")), id]);
    } else if (current.includes(id)) {
      const remaining = current.filter((item) => item !== id);
      if (remaining.length > 0) assignments.set(key, remaining);
      else assignments.delete(key);
    }
    set({ userBadgeAssignments: assignments });
  },
  setFfzRoleBadges: (channelId, badges) => {
    const roleBadges = new Map(get().ffzRoleBadges);
    if (badges.moderator || badges.vip) roleBadges.set(channelId, badges);
    else roleBadges.delete(channelId);
    set({ ffzRoleBadges: roleBadges });
  },
  getUserCosmetics: (channelId, userId) => {
    const state = get();
    const key = scopeKey(channelId, userId);
    const badgeIds = [
      ...(state.globalUserBadgeAssignments.get(userId) ?? []),
      ...(state.userBadgeAssignments.get(key) ?? []),
    ];
    const badges = badgeIds
      .map((id) => state.badgeDefinitions.get(id))
      .filter((badge): badge is ChatCosmeticBadge => badge !== undefined);
    const paintId = state.userPaintAssignments.get(key);
    const paint = paintId ? state.paintDefinitions.get(paintId) : undefined;
    return { badges, ...(paint ? { paint } : {}) };
  },
  acquireSevenTvChannel: (channelId) => {
    const leases = new Map(get().sevenTvChannelLeases);
    leases.set(channelId, (leases.get(channelId) ?? 0) + 1);
    set({ sevenTvChannelLeases: leases });
  },
  releaseSevenTvChannel: (channelId) => {
    const leases = new Map(get().sevenTvChannelLeases);
    const remainingLeases = (leases.get(channelId) ?? 0) - 1;
    if (remainingLeases > 0) {
      leases.set(channelId, remainingLeases);
      set({ sevenTvChannelLeases: leases });
      return;
    }
    leases.delete(channelId);
    const prefix = `${channelId}:`;
    const badges = new Map(get().userBadgeAssignments);
    for (const [key, ids] of badges) {
      if (!key.startsWith(prefix)) continue;
      const remaining = ids.filter((id) => !id.startsWith("7tv:"));
      if (remaining.length > 0) badges.set(key, remaining);
      else badges.delete(key);
    }
    set({
      userBadgeAssignments: badges,
      userPaintAssignments: withoutPrefix(get().userPaintAssignments, prefix),
      sevenTvChannelLeases: leases,
    });
  },
  reset: () =>
    set({
      badgeDefinitions: new Map(),
      paintDefinitions: new Map(),
      globalUserBadgeAssignments: new Map(),
      userBadgeAssignments: new Map(),
      userPaintAssignments: new Map(),
      ffzRoleBadges: new Map(),
      globalProviderLoadState: new Map(),
      sevenTvChannelLeases: new Map(),
    }),
}));

function scopeKey(channelId: string, userId: string): string {
  return `${channelId}:${userId}`;
}

function withoutPrefix<T>(source: Map<string, T>, prefix: string): Map<string, T> {
  return new Map([...source].filter(([key]) => !key.startsWith(prefix)));
}
