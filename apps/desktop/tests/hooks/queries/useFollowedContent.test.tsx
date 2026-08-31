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
// Guards: every followed channel contributes videos and clips; large lists are processed with bounded concurrency.
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

  it("does not cap merged followed videos or clips by followed-channel count", async () => {
    const channels = Array.from({ length: 35 }, (_, index) =>
      fixtures.channel({
        id: `channel-${index}`,
        username: `followedchannel${index}`,
        displayName: `FollowedChannel${index}`,
      })
    );

    let activeVideoRequests = 0;
    let peakVideoRequests = 0;
    api.videos.getByChannel = async ({ channelName }: { channelName: string }) => {
      activeVideoRequests += 1;
      peakVideoRequests = Math.max(peakVideoRequests, activeVideoRequests);
      await Promise.resolve();
      activeVideoRequests -= 1;
      return {
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
      };
    };

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

    await videos.result.current.fetchNextPage();
    await waitFor(() => expect(videos.result.current.data).toHaveLength(96));
    await videos.result.current.fetchNextPage();
    await waitFor(() => expect(videos.result.current.data).toHaveLength(140));
    await clips.result.current.fetchNextPage();
    await waitFor(() => expect(clips.result.current.data).toHaveLength(96));
    await clips.result.current.fetchNextPage();
    await waitFor(() => expect(clips.result.current.data).toHaveLength(140));

    expect(videos.result.current.data).toHaveLength(140);
    expect(clips.result.current.data).toHaveLength(140);
    expect(peakVideoRequests).toBeLessThanOrEqual(6);
  });

  it("continues followed videos from each channel cursor instead of stopping at one page", async () => {
    const requestedCursors: Array<string | undefined> = [];
    api.videos.getByChannel = async ({ cursor }: { cursor?: string }) => {
      requestedCursors.push(cursor);
      const page = cursor === undefined ? 0 : cursor === "page-2" ? 1 : 2;
      return {
        success: true,
        data: Array.from({ length: page === 2 ? 2 : 4 }, (_, index) => ({
          id: `video-${page * 4 + index}`,
          title: `Video ${page * 4 + index}`,
          duration: "00:10:00",
          views: `${page * 4 + index}`,
          date: new Date(Date.UTC(2026, 5, 19, 12, page, index)).toISOString(),
          created_at: new Date(Date.UTC(2026, 5, 19, 12, page, index)).toISOString(),
          thumbnailUrl: `https://example.com/video-${page * 4 + index}.jpg`,
        })),
        cursor: page === 0 ? "page-2" : page === 1 ? "page-3" : undefined,
      };
    };

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

    await waitFor(() => expect(result.current.data).toHaveLength(4));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data).toHaveLength(8));
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data).toHaveLength(10));

    expect(result.current.hasNextPage).toBe(false);
    expect(requestedCursors).toEqual([undefined, "page-2", "page-3"]);
  });
});
