import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import type { MultiStreamConfig } from "@/store/multistream-store";
import { useMultiStreamStore } from "@/store/multistream-store";

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
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&h=160&q=85",
  "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=160&h=160&q=85",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&h=160&q=85",
  "https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=160&h=160&q=85",
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
      isLive: false,
      isVerified: index === 0,
      isPartner: index === 0,
      followerCount: 48_000 - index * 7_000,
      categoryId: "516575",
      categoryName: "VALORANT",
      lastStreamTitle: "Community night highlights",
    } satisfies UnifiedChannel,
  ])
);

export function installMultistreamMocks() {
  window.electronAPI.channels.getByUsername = async ({ username }) => ({
    success: true,
    data: channelByName[username.toLowerCase()] ?? channelByName.novaarcade,
  });
  window.electronAPI.streams.getPlaybackUrl = async () => ({
    success: false,
    error: "Channel is offline",
  });
  window.electronAPI.slot.isWcvEnabled = async () => false;
  window.electronAPI.slot.rebindExistingSlots = async () => undefined;
  window.electronAPI.slot.requestFocus = async () => undefined;
  window.electronAPI.store.get = async <T>() => null as T | null;
  window.electronAPI.store.set = async () => undefined;
}

export function resetMultistreamStore({
  streams = multistreamFixtures.slice(0, 3),
  layout = "grid",
  focusedStreamId = null,
  chatStreamId = streams[0]?.id ?? null,
  multiviewCap = 6,
}: {
  streams?: MultiStreamConfig[];
  layout?: "grid" | "focus";
  focusedStreamId?: string | null;
  chatStreamId?: string | null;
  multiviewCap?: number;
} = {}) {
  useMultiStreamStore.setState({
    streams,
    layout,
    focusedStreamId,
    chatStreamId,
    isChatOpen: true,
    multiviewCap,
    backgroundQuality: "auto-low",
  });
}
