import type { Emote, EmoteProvider } from "../../backend/services/emotes/emote-types";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "../../shared/auth-types";
import type {
  ChatBadge,
  ChatMessage,
  NormalizedPinnedMessage,
  UnifiedPrediction,
} from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { useChatStore } from "../../store/chat-store";
import { useEmoteStore } from "../../store/emote-store";
import { DEFAULT_ROOM_STATE, roomStateKey, useRoomStateStore } from "../../store/room-state-store";

export const TWITCH_CHANNEL = "novaarcade";
export const KICK_CHANNEL = "pixelnomad";
export const STORY_CHANNEL_ID = "storybook-channel";
export const TWITCH_CHANNEL_KEY = `twitch:${TWITCH_CHANNEL}`;
export const KICK_CHANNEL_KEY = `kick:${KICK_CHANNEL}`;

const svgDataUri = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`
  )}`;

export const TWITCH_BADGE: ChatBadge = {
  setId: "moderator",
  version: "1",
  title: "Moderator",
  imageUrl: svgDataUri(
    '<rect width="64" height="64" rx="12" fill="#9146ff"/><path d="M16 42 42 16l6 6-26 26H16v-6Z" fill="white"/>'
  ),
};

export const KICK_BADGE: ChatBadge = {
  setId: "subscriber",
  version: "12",
  title: "12 Month Subscriber",
  imageUrl: svgDataUri(
    '<rect width="64" height="64" rx="12" fill="#53fc18"/><path d="m32 11 6 13 14 2-10 10 2 15-12-7-12 7 2-15-10-10 14-2 6-13Z" fill="#0f0f0f"/>'
  ),
};

export const STORY_AVATAR = svgDataUri(
  '<rect width="64" height="64" rx="32" fill="#252525"/><circle cx="32" cy="25" r="12" fill="#a970ff"/><path d="M12 58c3-15 10-21 20-21s17 6 20 21" fill="#53fc18"/>'
);

function makeEmote(
  id: string,
  name: string,
  provider: EmoteProvider,
  color: string,
  overrides: Partial<Emote> = {}
): Emote {
  const url = svgDataUri(
    `<circle cx="32" cy="32" r="30" fill="${color}"/><circle cx="22" cy="27" r="4" fill="#0f0f0f"/><circle cx="42" cy="27" r="4" fill="#0f0f0f"/><path d="M18 39c8 9 20 9 28 0" fill="none" stroke="#0f0f0f" stroke-width="5" stroke-linecap="round"/>`
  );

  return {
    id,
    name,
    provider,
    isGlobal: true,
    isAnimated: false,
    isZeroWidth: false,
    urls: { url1x: url, url2x: url, url4x: url },
    ...overrides,
  };
}

export const KAPPA_EMOTE = makeEmote("25", "Kappa", "twitch", "#a970ff");
export const KICK_EMOTE = makeEmote("1730756", "Cheerful", "kick", "#53fc18", {
  isGlobal: false,
  channelId: STORY_CHANNEL_ID,
});
export const SEVEN_TV_EMOTE = makeEmote("01HSTORY", "RainTime", "7tv", "#38bdf8", {
  isAnimated: true,
  channelId: STORY_CHANNEL_ID,
  owner: {
    id: "owner-7tv",
    username: "mira",
    displayName: "Mira Makes",
  },
});
export const SUBSCRIBER_EMOTE = makeEmote("sub-heart", "NovaLove", "twitch", "#f472b6", {
  isGlobal: false,
  channelId: STORY_CHANNEL_ID,
  subscribersOnly: true,
});
export const ZERO_WIDTH_EMOTE = makeEmote("zero-spark", "SparkOverlay", "7tv", "#f5c451", {
  isZeroWidth: true,
  channelId: STORY_CHANNEL_ID,
});

export const CHAT_EMOTES = [
  KAPPA_EMOTE,
  KICK_EMOTE,
  SEVEN_TV_EMOTE,
  SUBSCRIBER_EMOTE,
  ZERO_WIDTH_EMOTE,
];

export const REPLY_FIXTURE = {
  parentMessageId: "twitch-parent",
  parentUserId: "user-mira",
  parentUsername: "miramakes",
  parentDisplayName: "MiraMakes",
  parentMessageBody: "That clutch was unreal. One more round?",
};

export function makeChatMessage(index: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  const platform = index % 2 === 0 ? "twitch" : "kick";
  const username = platform === "twitch" ? "novafriend" : "kickviewer";
  const displayName = platform === "twitch" ? "NovaFriend" : "KickViewer";
  const emote = platform === "twitch" ? KAPPA_EMOTE : KICK_EMOTE;

  return {
    id: `storybook-message-${index}`,
    platform,
    type: "message",
    channel: platform === "twitch" ? TWITCH_CHANNEL : KICK_CHANNEL,
    userId: `user-${index}`,
    username,
    displayName,
    color: platform === "twitch" ? "#a970ff" : "#53fc18",
    badges: platform === "twitch" ? [TWITCH_BADGE] : [KICK_BADGE],
    content: [
      { type: "text", content: index % 3 === 0 ? "Great play " : "Chat is flying " },
      {
        type: "emote",
        id: emote.id,
        name: emote.name,
        url: emote.urls.url2x,
      },
      { type: "text", content: " " },
      { type: "mention", username: "NovaArcade" },
    ],
    rawContent: "Great play Kappa @NovaArcade",
    timestamp: new Date(Date.UTC(2026, 6, 26, 20, index, 0)),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
    ...overrides,
  };
}

export const TWITCH_MESSAGE = makeChatMessage(0);
export const KICK_MESSAGE = makeChatMessage(1);
export const REPLY_MESSAGE = makeChatMessage(2, {
  id: "storybook-reply",
  replyTo: REPLY_FIXTURE,
});
export const HIGHLIGHTED_MESSAGE = makeChatMessage(3, {
  id: "storybook-highlighted",
  platform: "twitch",
  channel: TWITCH_CHANNEL,
  isHighlighted: true,
  content: [{ type: "text", content: "This deserves a spotlight!" }],
});
export const DELETED_MESSAGE = makeChatMessage(4, {
  id: "storybook-deleted",
  isDeleted: true,
});
export const HISTORICAL_MESSAGE = makeChatMessage(5, {
  id: "storybook-historical",
  platform: "twitch",
  channel: TWITCH_CHANNEL,
  isHistorical: true,
  content: [{ type: "text", content: "A message loaded from recent chat history." }],
});
export const SYSTEM_MESSAGE = makeChatMessage(6, {
  id: "storybook-system",
  type: "system",
  username: "system",
  displayName: "System",
  badges: [],
  content: [{ type: "text", content: "Connected to chat." }],
  rawContent: "Connected to chat.",
});

export const CHAT_MESSAGES = [
  HISTORICAL_MESSAGE,
  TWITCH_MESSAGE,
  REPLY_MESSAGE,
  HIGHLIGHTED_MESSAGE,
  DELETED_MESSAGE,
  SYSTEM_MESSAGE,
];

export const PINNED_MESSAGE: NormalizedPinnedMessage = {
  platform: "twitch",
  messageId: "pin-message-1",
  pinRecordId: "pin-record-1",
  author: {
    username: "miramakes",
    displayName: "MiraMakes",
    color: "#f472b6",
    badges: [TWITCH_BADGE],
  },
  content: [
    { type: "text", content: "Community game after this run " },
    {
      type: "emote",
      id: KAPPA_EMOTE.id,
      name: KAPPA_EMOTE.name,
      url: KAPPA_EMOTE.urls.url2x,
    },
    { type: "text", content: " " },
    { type: "mention", username: "NovaArcade" },
  ],
  pinnedBy: {
    username: "channelmod",
    color: "#38bdf8",
    badges: [TWITCH_BADGE],
  },
  pinnedAt: new Date(Date.now() - 45_000).toISOString(),
  sentAt: new Date(Date.now() - 90_000).toISOString(),
  expiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
};

export function makePrediction(
  platform: "twitch" | "kick",
  overrides: Partial<UnifiedPrediction> = {}
): UnifiedPrediction {
  return {
    id: `prediction-${platform}`,
    platform,
    channelId: STORY_CHANNEL_ID,
    channelSlug: platform === "twitch" ? TWITCH_CHANNEL : KICK_CHANNEL,
    title: "Will the next run beat the personal best?",
    status: "ACTIVE",
    outcomes: [
      {
        id: "yes",
        title: "New personal best",
        color: platform === "twitch" ? "blue" : null,
        totalAmount: 42_750,
        userCount: 318,
      },
      {
        id: "no",
        title: "Not this run",
        color: platform === "twitch" ? "pink" : null,
        totalAmount: 18_200,
        userCount: 147,
      },
    ],
    winningOutcomeId: null,
    predictionWindowSeconds: 300,
    createdAt: new Date(Date.now() - 90_000).toISOString(),
    endedAt: null,
    viewerOutcomeId: "yes",
    viewerStake: 2_500,
    ...overrides,
  };
}

function emotesByProvider(): Map<EmoteProvider, Emote[]> {
  const grouped = new Map<EmoteProvider, Emote[]>();
  for (const emote of CHAT_EMOTES) {
    grouped.set(emote.provider, [...(grouped.get(emote.provider) ?? []), emote]);
  }
  return grouped;
}

export function seedChatStoryStores(
  options: { predictionStyle?: UserPreferences["predictions"]["style"]; roomModes?: boolean } = {}
): void {
  const predictionStyle = options.predictionStyle ?? "native";
  useAuthStore.setState({
    twitchConnected: true,
    kickConnected: true,
    isGuest: false,
    initialized: true,
    twitchUser: {
      id: "viewer-twitch",
      login: "novaviewer",
      displayName: "NovaViewer",
      profileImageUrl: "",
      createdAt: "2022-01-01T00:00:00.000Z",
      broadcasterType: "affiliate",
    },
    kickUser: {
      id: 7419,
      username: "NovaViewer",
      slug: "novaviewer",
      profilePic: "",
      verified: true,
    },
    preferences: {
      ...DEFAULT_USER_PREFERENCES,
      predictions: {
        ...DEFAULT_USER_PREFERENCES.predictions,
        style: predictionStyle,
      },
    },
  });

  useChatStore.setState({
    messages: [...CHAT_MESSAGES, KICK_MESSAGE, makeChatMessage(7), makeChatMessage(9)],
    isPaused: false,
  });

  const grouped = emotesByProvider();
  useEmoteStore.setState({
    isLoading: false,
    loadedGlobalPlatforms: new Set(["twitch", "kick"]),
    loadedChannels: new Set([STORY_CHANNEL_ID]),
    recentEmotes: [KAPPA_EMOTE, KICK_EMOTE, SEVEN_TV_EMOTE],
    favoriteEmotes: [SEVEN_TV_EMOTE, KAPPA_EMOTE],
    activeChannelId: STORY_CHANNEL_ID,
    getEmotesByProvider: () => grouped,
    getAllEmotes: () => CHAT_EMOTES,
    searchEmotes: (query, limit = 20) =>
      CHAT_EMOTES.filter((emote) => emote.name.toLowerCase().includes(query.toLowerCase())).slice(
        0,
        limit
      ),
  });

  useRoomStateStore.setState({
    entries: options.roomModes
      ? {
          [roomStateKey("twitch", STORY_CHANNEL_ID)]: {
            ...DEFAULT_ROOM_STATE,
            followersOnly: 10,
            slowMode: 30,
            subscribersOnly: true,
            uniqueChat: true,
          },
          [roomStateKey("kick", STORY_CHANNEL_ID)]: {
            ...DEFAULT_ROOM_STATE,
            accountAge: 60,
            emoteOnly: true,
            slowMode: 15,
          },
        }
      : {},
  });
}
