import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { useFollowedClips, useFollowedVideos } from "@/features/discovery/data/queries/useFollowedContent";

import { fixtures, installElectronAPIMock } from "../../test-utils";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

let api: ReturnType<typeof installElectronAPIMock>;

// Guards: followed videos only include past VODs, never currently-live or zero-duration stream placeholders
// Guards: followed videos and clips are not capped at 60 after merging followed-channel results
describe("useFollowedContent", () => {
  beforeEach(() => {
    api = installElectronAPIMock();
  });

  it("filters live/current stream entries out of followed videos", async () => {
    api.videos.getByChannel = async () => ({
      success: true,
      data: [
        {
          id: "live-video",
          title: "Live right now",
          duration: "0:00",
          views: "1",
          date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          thumbnailUrl: "https://example.com/live.jpg",
          isLive: true,
        },
        {
          id: "current-placeholder",
          title: "Current stream placeholder",
          duration: "00:00",
          views: "2",
          date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          thumbnailUrl: "https://example.com/current.jpg",
        },
        {
          id: "live-no-thumbnail",
          title: "Still live but has duration",
          duration: "01:00:00",
          views: "4",
          date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          thumbnailUrl: "",
        },
        {
          id: "live-processing-thumbnail",
          title: "Still live with Twitch processing thumbnail",
          duration: "00:45:00",
          views: "5",
          date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          thumbnailUrl: "https://vod-secure.twitch.tv/_404/404_processing_320x180.png",
        },
        {
          id: "past-vod",
          title: "Past VOD",
          duration: "01:02:03",
          views: "3",
          date: "2026-06-19T12:00:00.000Z",
          created_at: "2026-06-19T12:00:00.000Z",
          thumbnailUrl: "https://example.com/past.jpg",
        },
      ],
    });

    const { result } = renderHook(
      () =>
        useFollowedVideos([
          fixtures.channel({
            id: "channel-1",
            username: "followedchannel",
            displayName: "FollowedChannel",
          }),
        ]),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.map((video) => video.id)).toEqual(["past-vod"]);
  });

  it("does not cap merged followed videos or clips at 60 items", async () => {
    const channels = Array.from({ length: 16 }, (_, index) =>
      fixtures.channel({
        id: `channel-${index}`,
        username: `followedchannel${index}`,
        displayName: `FollowedChannel${index}`,
      })
    );

    api.videos.getByChannel = async ({ channelName }: { channelName: string }) => ({
      success: true,
      data: Array.from({ length: 4 }, (_, index) => ({
        id: `video-${channelName}-${index}`,
        title: `Video ${channelName} ${index}`,
        duration: "00:10:00",
        views: `${index}`,
        date: new Date(Date.UTC(2026, 5, 19, 12, index)).toISOString(),
        created_at: new Date(Date.UTC(2026, 5, 19, 12, index)).toISOString(),
        thumbnailUrl: `https://example.com/${channelName}-${index}.jpg`,
      })),
    });

    api.clips.getByChannel = async ({ channelName }: { channelName: string }) => ({
      success: true,
      data: Array.from({ length: 4 }, (_, index) => ({
        id: `clip-${channelName}-${index}`,
        title: `Clip ${channelName} ${index}`,
        duration: "0:30",
        views: `${index}`,
        date: new Date(Date.UTC(2026, 5, 19, 12, index)).toISOString(),
        created_at: new Date(Date.UTC(2026, 5, 19, 12, index)).toISOString(),
        thumbnailUrl: `https://example.com/${channelName}-${index}.jpg`,
      })),
    });

    const wrapper = makeWrapper();
    const videos = renderHook(() => useFollowedVideos(channels), { wrapper });
    const clips = renderHook(() => useFollowedClips(channels), { wrapper });

    await waitFor(() => expect(videos.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(clips.result.current.isSuccess).toBe(true));

    expect(videos.result.current.data).toHaveLength(64);
    expect(clips.result.current.data).toHaveLength(64);
  });
});
