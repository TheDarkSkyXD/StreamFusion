import type { UnifiedChannel } from "@shared/platform-types";
import { kickChatService } from "@backend/services/chat/kick-chat";
import { twitchChatService } from "@backend/services/chat/twitch-chat";
import type { ModLogEntry } from "@shared/mod-log-types";
import { useAuthStore } from "@/store/auth-store";
import { useChatStore } from "@/store/chat-store";
import { useEmoteStore } from "@/store/emote-store";
import { useFollowStore } from "@/store/follow-store";

import {
  KICK_CHANNEL,
  STORY_AVATAR,
  STORY_CHANNEL_ID,
  seedChatStoryStores,
  TWITCH_CHANNEL,
} from "./chat-story-fixtures";
import type { UserProfile } from "./mod/UserPopout/useUserProfile";

export const CHAT_STORY_MOD_LOG: ModLogEntry[] = [
  {
    id: 101,
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
    channelSlug: TWITCH_CHANNEL,
    action: "timeout",
    targetUserId: "user-mira",
    targetUsername: "miramakes",
    moderatorUserId: "viewer-twitch",
    moderatorUsername: "novaviewer",
    durationSeconds: 600,
    reason: "Repeated spoilers",
    provenance: "streamfusion-confirmed",
    providerEventId: null,
    occurredAt: Date.UTC(2026, 6, 26, 19, 40),
    observedAt: Date.UTC(2026, 6, 26, 19, 40),
    createdAt: Date.UTC(2026, 6, 26, 19, 40),
  },
  {
    id: 102,
    platform: "twitch",
    channelId: STORY_CHANNEL_ID,
    channelSlug: TWITCH_CHANNEL,
    action: "delete",
    targetUserId: "user-mira",
    targetUsername: "miramakes",
    moderatorUserId: "viewer-twitch",
    moderatorUsername: "novaviewer",
    reason: "Removed a duplicate message",
    provenance: "streamfusion-confirmed",
    providerEventId: null,
    occurredAt: Date.UTC(2026, 6, 26, 19, 35),
    observedAt: Date.UTC(2026, 6, 26, 19, 35),
    createdAt: Date.UTC(2026, 6, 26, 19, 35),
  },
];

export const CHAT_STORY_PROFILE: UserProfile = {
  userId: "user-mira",
  username: "miramakes",
  displayName: "MiraMakes",
  avatarUrl: STORY_AVATAR,
  createdAt: "2021-03-14T10:00:00.000Z",
  followSince: "2023-08-19T16:30:00.000Z",
  subscription: {
    tier: "1000",
    months: 18,
    isGift: false,
  },
  isFounder: true,
  isVip: true,
  isMod: true,
  verified: true,
};

export const CHAT_STORY_FOLLOWS: UnifiedChannel[] = [
  {
    id: "raid-channel-1",
    platform: "twitch",
    username: "rift_runner",
    displayName: "RiftRunner",
    avatarUrl: STORY_AVATAR,
    isLive: true,
    isVerified: true,
    isPartner: true,
    categoryName: "VALORANT",
  },
  {
    id: "raid-channel-2",
    platform: "twitch",
    username: "cozy_coder",
    displayName: "CozyCoder",
    avatarUrl: STORY_AVATAR,
    isLive: false,
    isVerified: false,
    isPartner: false,
    categoryName: "Science & Technology",
  },
  {
    id: "kick-follow-1",
    platform: "kick",
    username: "pixelnomad",
    displayName: "PixelNomad",
    avatarUrl: STORY_AVATAR,
    isLive: true,
    isVerified: true,
    isPartner: true,
  },
];

export function seedChatSubsystemStoryStores(): void {
  seedChatStoryStores({ roomModes: true });
  useFollowStore.setState({
    localFollows: CHAT_STORY_FOLLOWS,
  });
}

let servicesMocked = false;

/**
 * Storybook imports the real orchestrators, but their socket seams are replaced
 * before mount. Store hydration is also made local so stories never contact
 * Twitch, Kick, 7TV, BTTV, or FFZ.
 */
export function installChatOrchestratorStoryMocks(): void {
  seedChatSubsystemStoryStores();
  useAuthStore.setState({
    twitchConnected: false,
    kickConnected: false,
    twitchReconnectRequired: false,
  });

  useEmoteStore.setState({
    loadGlobalEmotes: async () => undefined,
    loadChannelEmotes: async () => undefined,
    unloadChannelEmotes: () => undefined,
    setActiveChannel: () => undefined,
    applyProviderPrefs: () => undefined,
  });

  useChatStore.setState({
    connectionStatus: {
      twitch: {
        platform: "twitch",
        state: "connected",
        channels: [TWITCH_CHANNEL],
        isAuthenticated: false,
      },
      kick: {
        platform: "kick",
        state: "connected",
        channels: [KICK_CHANNEL],
        isAuthenticated: false,
      },
    },
  });

  if (servicesMocked) return;
  servicesMocked = true;

  twitchChatService.connect = async () => undefined;
  twitchChatService.disconnect = async () => undefined;
  twitchChatService.joinChannel = async () => undefined;
  twitchChatService.getConnectionStatus = () => ({
    platform: "twitch",
    state: "connected",
    channels: [TWITCH_CHANNEL],
    isAuthenticated: false,
  });

  kickChatService.connect = async () => undefined;
  kickChatService.disconnect = async () => undefined;
  kickChatService.joinChannel = async () => undefined;
  kickChatService.getConnectionStatus = () => ({
    platform: "kick",
    state: "connected",
    channels: [KICK_CHANNEL],
    isAuthenticated: false,
  });
}
