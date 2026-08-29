import type { UnifiedChannel } from "@shared/platform-types";

import type { VideoOrClip } from "./types";

const thumbnails = [
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=960&h=540&q=85",
  "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=960&h=540&q=85",
  "https://images.unsplash.com/photo-1598550476439-6847785fcea6?auto=format&fit=crop&w=960&h=540&q=85",
  "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=960&h=540&q=85",
];

export const relatedChannel: UnifiedChannel = {
  id: "channel-story-1",
  platform: "twitch",
  username: "novaarcade",
  displayName: "NovaArcade",
  avatarUrl:
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&h=160&q=85",
  bio: "Competitive games, calm comms, and community nights.",
  isLive: true,
  isVerified: true,
  isPartner: true,
  followerCount: 385_000,
  categoryId: "516575",
  categoryName: "VALORANT",
  lastStreamTitle: "Road to radiant with calm comms",
};

export function makeVideo(index: number, overrides: Partial<VideoOrClip> = {}): VideoOrClip {
  return {
    id: `video-story-${index + 1}`,
    title: [
      "Radiant ranked: the comeback run",
      "Community night highlights",
      "Reviewing the new patch",
      "Late-night duo queue",
    ][index % 4],
    duration: index === 0 ? "2:14:32" : "1:08:45",
    views: String(48_200 - index * 5_300),
    date: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
    created_at: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
    thumbnailUrl: thumbnails[index % thumbnails.length],
    source: "https://example.com/archive/story.m3u8",
    gameName: "VALORANT",
    channelName: "NovaArcade",
    channelSlug: "novaarcade",
    channelAvatar: relatedChannel.avatarUrl,
    category: "VALORANT",
    tags: ["Ranked", "English"],
    language: "en",
    platform: "twitch",
    ...overrides,
  };
}

export function makeClip(index: number, overrides: Partial<VideoOrClip> = {}): VideoOrClip {
  return {
    ...makeVideo(index),
    id: `clip-story-${index + 1}`,
    title: ["Last-second ace", "The cleanest flick", "Perfect utility timing", "Chat called it"][
      index % 4
    ],
    duration: index === 0 ? "0:31" : "0:18",
    creatorName: index % 2 === 0 ? "PixelNomad" : "RiftRunner",
    embedUrl: `https://clips.twitch.tv/clip-story-${index + 1}`,
    url: `https://clips.twitch.tv/clip-story-${index + 1}`,
    vodId: "2233445566",
    ...overrides,
  };
}

export const relatedVideos = Array.from({ length: 8 }, (_, index) => makeVideo(index));
export const relatedClips = Array.from({ length: 8 }, (_, index) => makeClip(index));
