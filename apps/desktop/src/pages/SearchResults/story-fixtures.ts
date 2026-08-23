import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "@/backend/api/unified/platform-types";

function image(label: string, color: string, width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="52%" fill="#ffffff" font-family="sans-serif" font-size="28" font-weight="700" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const SEARCH_TIMESTAMP = "2026-08-10T12:00:00.000Z";

export const searchChannels: UnifiedChannel[] = [
  {
    id: "twitch-streamfusion",
    platform: "twitch",
    username: "streamfusion",
    displayName: "StreamFusion",
    avatarUrl: image("SF", "#4b2f7d", 160, 160),
    isLive: true,
    isVerified: true,
    isPartner: true,
    followerCount: 184_000,
    categoryName: "VALORANT",
    lastStreamTitle: "Calm ranked with the community",
  },
  {
    id: "kick-pixel-harbor",
    platform: "kick",
    username: "pixelharbor",
    displayName: "Pixel Harbor",
    avatarUrl: image("PH", "#215936", 160, 160),
    isLive: false,
    isVerified: false,
    isPartner: false,
    followerCount: 42_000,
    categoryName: "Art",
    lastStreamTitle: "Tiny worlds and friendly chat",
  },
];

export const searchStreams: UnifiedStream[] = [
  {
    id: "search-stream-twitch",
    platform: "twitch",
    channelId: "twitch-streamfusion",
    channelName: "streamfusion",
    channelDisplayName: "StreamFusion",
    channelAvatar: searchChannels[0].avatarUrl,
    channelIsVerified: true,
    title: "Calm ranked with the community",
    viewerCount: 18_420,
    thumbnailUrl: image("Ranked session", "#302252", 1280, 720),
    isLive: true,
    startedAt: SEARCH_TIMESTAMP,
    language: "en",
    tags: ["Ranked", "Community"],
    categoryId: "valorant",
    categoryName: "VALORANT",
  },
  {
    id: "search-stream-kick",
    platform: "kick",
    channelId: "kick-night-arcade",
    channelName: "nightarcade",
    channelDisplayName: "Night Arcade",
    channelAvatar: image("NA", "#275d34", 160, 160),
    title: "Late-night retro challenges",
    viewerCount: 6_870,
    thumbnailUrl: image("Retro challenge", "#234853", 1280, 720),
    isLive: true,
    startedAt: SEARCH_TIMESTAMP,
    language: "en",
    tags: ["Retro", "No spoilers"],
    categoryId: "retro",
    categoryName: "Retro",
  },
];

export const searchCategories: UnifiedCategory[] = [
  {
    id: "valorant",
    platform: "twitch",
    name: "VALORANT",
    boxArtUrl: image("VALORANT", "#8a3146", 570, 760),
    viewerCount: 124_000,
    tags: ["FPS", "Competitive"],
    slug: "valorant",
  },
  {
    id: "retro",
    platform: "kick",
    name: "Retro",
    boxArtUrl: image("RETRO", "#275d34", 570, 760),
    viewerCount: 19_800,
    tags: ["Classic", "Community"],
  },
];

export const searchVideos: UnifiedVideo[] = [
  {
    id: "search-video-twitch",
    platform: "twitch",
    channelId: "twitch-streamfusion",
    channelName: "streamfusion",
    channelDisplayName: "StreamFusion",
    channelAvatar: searchChannels[0].avatarUrl,
    title: "The community picks the next challenge",
    thumbnailUrl: image("Community replay", "#3c345d", 1280, 720),
    duration: 4_560,
    viewCount: 82_400,
    publishedAt: "2026-08-08T12:00:00.000Z",
    url: "https://example.invalid/videos/search-video-twitch",
    shareUrl: "https://example.invalid/videos/search-video-twitch",
    type: "archive",
  },
];

export const searchClips: UnifiedClip[] = [
  {
    id: "search-clip-kick",
    platform: "kick",
    channelId: "kick-night-arcade",
    channelName: "nightarcade",
    channelDisplayName: "Night Arcade",
    channelAvatar: searchStreams[1].channelAvatar,
    title: "One-frame win",
    thumbnailUrl: image("One-frame win", "#284c50", 1280, 720),
    clipUrl: "https://example.invalid/clips/search-clip-kick",
    shareUrl: "https://example.invalid/clips/search-clip-kick",
    embedUrl: "https://example.invalid/embed/search-clip-kick",
    duration: 42,
    viewCount: 19_200,
    createdAt: "2026-08-09T12:00:00.000Z",
    creatorName: "Alex",
    gameId: "retro",
    gameName: "Retro",
  },
];

export const populatedSearchResults = {
  channels: searchChannels,
  streams: searchStreams,
  categories: searchCategories,
  videos: searchVideos,
  clips: searchClips,
};
