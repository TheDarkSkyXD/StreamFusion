import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedStream,
} from "../src/shared/platform-types";

const categoryImages = [
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=570&h=760&q=80",
  "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=570&h=760&q=80",
  "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=570&h=760&q=80",
  "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=570&h=760&q=80",
  "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?auto=format&fit=crop&w=570&h=760&q=80",
  "https://images.unsplash.com/photo-1598550476439-6847785fcea6?auto=format&fit=crop&w=570&h=760&q=80",
];

const streamImages = [
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1280&h=720&q=85",
  "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1280&h=720&q=85",
  "https://images.unsplash.com/photo-1598550476439-6847785fcea6?auto=format&fit=crop&w=1280&h=720&q=85",
  "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=1280&h=720&q=85",
];

const avatarImages = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&h=160&q=85",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&h=160&q=85",
  "https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=160&h=160&q=85",
  "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=160&h=160&q=85",
];

export function makeCategory(
  index: number,
  overrides: Partial<UnifiedCategory> = {}
): UnifiedCategory {
  const names = [
    "Just Chatting",
    "Grand Theft Auto V",
    "VALORANT",
    "Minecraft",
    "League of Legends",
    "Art",
    "Music",
    "Retro",
  ];
  const platform = index % 2 === 0 ? "twitch" : "kick";

  return {
    id: `category-${index + 1}`,
    platform,
    name: names[index % names.length],
    boxArtUrl: categoryImages[index % categoryImages.length],
    viewerCount: Math.max(920, 184_600 - index * 17_450),
    tags: index % 3 === 0 ? ["Social", "English", "Community"] : ["Multiplayer", "Competitive"],
    slug: `category-${index + 1}`,
    ...overrides,
  };
}

export const categoryFixtures = Array.from({ length: 24 }, (_, index) => makeCategory(index));

export function makeStream(index: number, overrides: Partial<UnifiedStream> = {}): UnifiedStream {
  const platform = index % 2 === 0 ? "twitch" : "kick";
  const channelNames = ["NovaArcade", "RiftRunner", "MiraMakes", "PixelNomad"];
  const titles = [
    "Road to radiant, calm comms and good decisions",
    "First playthrough, no spoilers please",
    "Building a tiny fantasy city from scratch",
    "Late-night ranked with the community",
  ];
  const categories = ["VALORANT", "Elden Ring", "Art", "League of Legends"];

  return {
    id: `stream-${index + 1}`,
    platform,
    channelId: `channel-${index + 1}`,
    channelName: channelNames[index % channelNames.length].toLowerCase(),
    channelDisplayName: channelNames[index % channelNames.length],
    channelAvatar: avatarImages[index % avatarImages.length],
    channelIsVerified: index % 3 === 0,
    title: titles[index % titles.length],
    viewerCount: Math.max(87, 48_230 - index * 4_120),
    thumbnailUrl: streamImages[index % streamImages.length],
    isLive: true,
    startedAt: new Date(Date.now() - (index + 1) * 47 * 60_000).toISOString(),
    language: index % 4 === 3 ? "es" : "en",
    tags: index % 2 === 0 ? ["Ranked", "Competitive"] : ["Cozy", "No Spoilers"],
    isMature: index % 5 === 4,
    categoryId: `game-${index + 1}`,
    categoryName: categories[index % categories.length],
    ...overrides,
  };
}

export const streamFixtures = Array.from({ length: 12 }, (_, index) => makeStream(index));

export function makeChannel(
  index: number,
  overrides: Partial<UnifiedChannel> = {}
): UnifiedChannel {
  const stream = makeStream(index);

  return {
    id: stream.channelId,
    platform: stream.platform,
    username: stream.channelName,
    displayName: stream.channelDisplayName,
    avatarUrl: stream.channelAvatar,
    bio: "Variety streams, creative challenges, and a welcoming chat.",
    isLive: stream.isLive,
    isVerified: stream.channelIsVerified ?? false,
    isPartner: index % 3 === 0,
    followerCount: Math.max(1_200, 385_000 - index * 31_000),
    categoryId: stream.categoryId,
    categoryName: stream.categoryName,
    lastStreamTitle: stream.title,
    ...overrides,
  };
}
