import type { UnifiedChannel, UnifiedStream } from "@shared/platform-types";
import type {
  FavoriteStreamRef,
  MultiStreamConfig,
} from "@/features/multistream/data/multistream-store";
import { useMultiStreamStore } from "@/features/multistream/data/multistream-store";

export const multistreamFixtures: MultiStreamConfig[] = [
  {
    id: "twitch-novaarcade",
    platform: "twitch",
    channelName: "novaarcade",
    isMuted: false,
    volume: 0.72,
  },
  {
    id: "kick-miramakes",
    platform: "kick",
    channelName: "miramakes",
    isMuted: true,
    volume: 0.5,
  },
  {
    id: "twitch-riftrunner",
    platform: "twitch",
    channelName: "riftrunner",
    isMuted: true,
    volume: 0.45,
  },
  {
    id: "kick-pixelnomad",
    platform: "kick",
    channelName: "pixelnomad",
    isMuted: true,
    volume: 0.4,
  },
];

const channelDisplayNames = ["NovaArcade", "MiraMakes", "RiftRunner", "PixelNomad"];
const channelAvatarUrls = [
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%239146ff'/%3E%3Ctext x='32' y='40' fill='white' font-size='28' text-anchor='middle'%3EN%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%233dd912'/%3E%3Ctext x='32' y='40' fill='%230f0f0f' font-size='28' text-anchor='middle'%3EM%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23772ce8'/%3E%3Ctext x='32' y='40' fill='white' font-size='28' text-anchor='middle'%3ER%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%232d2d2d'/%3E%3Ctext x='32' y='40' fill='white' font-size='28' text-anchor='middle'%3EP%3C/text%3E%3C/svg%3E",
];

const channelByName: Record<string, UnifiedChannel> = Object.fromEntries(
  multistreamFixtures.map((stream, index) => [
    stream.channelName,
    {
      id: `channel-story-${index + 1}`,
      platform: stream.platform,
      username: stream.channelName,
      displayName: channelDisplayNames[index],
      avatarUrl: channelAvatarUrls[index],
      bio: "Storybook channel fixture",
      isLive: index < 2,
      isVerified: index === 0,
      isPartner: index === 0,
      followerCount: 48_000 - index * 7_000,
      categoryId: "516575",
      categoryName: "VALORANT",
      lastStreamTitle: "Community night highlights",
    } satisfies UnifiedChannel,
  ])
);

export const liveFavoriteFixtures: UnifiedStream[] = multistreamFixtures
  .slice(0, 2)
  .map((stream, index) => ({
    id: `live-story-${index + 1}`,
    platform: stream.platform,
    channelId: `channel-story-${index + 1}`,
    channelName: stream.channelName,
    channelDisplayName: channelDisplayNames[index],
    channelAvatar: channelAvatarUrls[index],
    title: index === 0 ? "Road to Radiant" : "Building a tiny ceramic city",
    viewerCount: index === 0 ? 18_420 : 3_810,
    thumbnailUrl: "",
    isLive: true,
    startedAt: "2026-08-02T18:00:00.000Z",
    language: "en",
    tags: [],
    categoryId: "516575",
    categoryName: index === 0 ? "VALORANT" : "Makers & Crafting",
  }));

export const multistreamFavoriteFixtures: FavoriteStreamRef[] = liveFavoriteFixtures.map(
  (stream) => ({
    platform: stream.platform,
    channelId: stream.channelId,
    channelName: stream.channelName,
    displayName: stream.channelDisplayName,
    avatarUrl: stream.channelAvatar,
  })
);

export function installMultistreamMocks(): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const previousBridge = window.electronAPI;
  const channels = Object.assign(Object.create(previousBridge.channels), {
    getByUsername: async ({ username }: { username: string }) => ({
      success: true,
      data: channelByName[username.toLowerCase()] ?? channelByName.novaarcade,
    }),
  }) as typeof previousBridge.channels;
  const streams = Object.assign(Object.create(previousBridge.streams), {
    getPlaybackUrl: async () => ({
      success: false,
      error: "Channel is offline",
    }),
    getByChannel: async ({ username }: { username: string }) => ({
      success: true,
      data: liveFavoriteFixtures.find((stream) => stream.channelName === username) ?? null,
    }),
  }) as typeof previousBridge.streams;
  const search = Object.assign(Object.create(previousBridge.search), {
    channels: async ({ query, platform }: { query: string; platform: "twitch" | "kick" }) => ({
      success: true,
      data: Object.values(channelByName).filter(
        (channel) =>
          channel.platform === platform &&
          channel.displayName.toLowerCase().includes(query.toLowerCase())
      ),
    }),
  }) as typeof previousBridge.search;
  const slot = Object.assign(Object.create(previousBridge.slot), {
    isWcvEnabled: async () => false,
    rebindExistingSlots: async () => undefined,
    requestFocus: async () => undefined,
  }) as typeof previousBridge.slot;
  const store = Object.assign(Object.create(previousBridge.store), {
    get: async <T>() => null as T | null,
    set: async () => undefined,
  }) as typeof previousBridge.store;
  const bridge = Object.create(previousBridge) as typeof previousBridge;

  Object.defineProperties(bridge, {
    channels: { configurable: true, value: channels },
    streams: { configurable: true, value: streams },
    search: { configurable: true, value: search },
    slot: { configurable: true, value: slot },
    store: { configurable: true, value: store },
  });
  Object.defineProperty(window, "electronAPI", { configurable: true, value: bridge });

  return () => {
    if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
    else Reflect.deleteProperty(window, "electronAPI");
  };
}

export function resetMultistreamStore({
  streams = multistreamFixtures.slice(0, 3),
  layout = "grid",
  focusedStreamId = null,
  chatStreamId = streams[0]?.id ?? null,
  isChatOpen = true,
  playbackBudget = 6,
  favoriteStreams = [],
}: {
  streams?: MultiStreamConfig[];
  layout?: "grid" | "focus";
  focusedStreamId?: string | null;
  chatStreamId?: string | null;
  isChatOpen?: boolean;
  playbackBudget?: number;
  favoriteStreams?: FavoriteStreamRef[];
} = {}) {
  useMultiStreamStore.setState({
    streams,
    layout,
    focusedStreamId,
    chatStreamId,
    isChatOpen,
    playbackBudget,
    favoriteStreams,
    backgroundQuality: "auto-low",
  });
}
