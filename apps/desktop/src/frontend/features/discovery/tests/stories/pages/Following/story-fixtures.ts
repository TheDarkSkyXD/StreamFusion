import type { UnifiedCategory, UnifiedChannel, UnifiedStream } from "@shared/platform-types";

function image(label: string, color: string, width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="52%" fill="#ffffff" font-family="sans-serif" font-size="28" font-weight="700" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const FOLLOWING_TIMESTAMP = "2026-08-10T12:00:00.000Z";

export const followedChannels: UnifiedChannel[] = [
  {
    id: "follow-twitch-lumen",
    platform: "twitch",
    username: "lumenlab",
    displayName: "Lumen Lab",
    avatarUrl: image("LL", "#4e3575", 160, 160),
    isLive: true,
    isVerified: true,
    isPartner: true,
    followerCount: 94_000,
    categoryName: "Science & Technology",
  },
  {
    id: "follow-kick-harbor",
    platform: "kick",
    username: "harborhours",
    displayName: "Harbor Hours",
    avatarUrl: image("HH", "#295d37", 160, 160),
    isLive: true,
    isVerified: false,
    isPartner: false,
    followerCount: 28_000,
    categoryName: "Just Chatting",
  },
];

export const followedStreams: UnifiedStream[] = followedChannels.map((channel, index) => ({
  id: `followed-stream-${channel.platform}`,
  platform: channel.platform,
  channelId: channel.id,
  channelName: channel.username,
  channelDisplayName: channel.displayName,
  channelAvatar: channel.avatarUrl,
  channelIsVerified: channel.isVerified,
  title: index === 0 ? "Building a better desk setup" : "Wind-down games and chat",
  viewerCount: index === 0 ? 8_480 : 3_120,
  thumbnailUrl: image(
    index === 0 ? "Desk build" : "Wind-down",
    index === 0 ? "#3b3158" : "#264f49",
    1280,
    720
  ),
  isLive: true,
  startedAt: FOLLOWING_TIMESTAMP,
  language: "en",
  tags: index === 0 ? ["Maker", "Technology"] : ["Community", "Cozy"],
  categoryId: index === 0 ? "science" : "chatting",
  categoryName: channel.categoryName,
}));

export const followedCategories: UnifiedCategory[] = [
  {
    id: "science",
    platform: "twitch",
    name: "Science & Technology",
    boxArtUrl: image("SCIENCE", "#4e3575", 570, 760),
    viewerCount: 44_800,
    tags: ["Maker", "Technology"],
    slug: "science-technology",
  },
  {
    id: "chatting",
    platform: "kick",
    name: "Just Chatting",
    boxArtUrl: image("CHAT", "#295d37", 570, 760),
    viewerCount: 32_600,
    tags: ["Community", "Talk"],
  },
];
