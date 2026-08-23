import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetRelatedContentRequestCache,
  RelatedContent,
} from "@/components/stream/related-content/index";

const mocks = vi.hoisted(() => ({
  activeTab: { current: undefined as "clips" | "videos" | undefined },
  clips: vi.fn(),
  prewarmViewportImages: vi.fn(async () => undefined),
  storeGet: vi.fn(async () => null),
  storeSet: vi.fn(async () => undefined),
  videos: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: {
      location: { search: { tab: "clips" | "videos" | undefined } };
    }) => unknown;
  }) =>
    select({
      location: { search: { tab: mocks.activeTab.current } },
    }),
}));

vi.mock("@/components/stream/related-content/ClipCard", () => ({
  ClipCard: ({ clip }: { clip: { title: string } }) => <div>{clip.title}</div>,
}));

vi.mock("@/components/stream/related-content/VideoCard", () => ({
  VideoCard: ({ video }: { video: { title: string } }) => <div>{video.title}</div>,
}));

vi.mock("@/components/stream/related-content/ContentTabs", () => ({
  ContentTabs: () => null,
}));

vi.mock("@/hooks/queries/recent-stream-prewarm", () => ({
  rememberRecentStreamImages: vi.fn(async () => undefined),
}));

vi.mock("@/lib/viewport-image-prewarm", () => ({
  prewarmViewportImages: mocks.prewarmViewportImages,
}));

// Guards: Home, Videos, and Clips warm their first thumbnail batch through the proxy-aware image cache before cards depend on browser lazy loading.
describe("RelatedContent image prewarm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRelatedContentRequestCache();
    mocks.activeTab.current = undefined;
    mocks.storeGet.mockResolvedValue(null);
    mocks.storeSet.mockResolvedValue(undefined);
    mocks.videos.mockResolvedValue({ success: true, data: [] });
    mocks.clips.mockResolvedValue({ success: true, data: [] });
    window.electronAPI = {
      videos: { getByChannel: mocks.videos },
      clips: { getByChannel: mocks.clips },
      store: { get: mocks.storeGet, set: mocks.storeSet },
    } as unknown as typeof window.electronAPI;
  });

  it.each([
    "home",
    "videos",
    "clips",
  ] as const)("prewarms the first %s thumbnail payload", async (tab) => {
    mocks.activeTab.current = tab === "home" ? undefined : tab;
    const video = {
      id: "v-warm",
      title: "Warm video",
      duration: "1:00",
      views: "10",
      date: "2026-08-21T00:00:00.000Z",
      thumbnailUrl: "https://cdn.test/video.jpg",
    };
    const clip = {
      id: "c-warm",
      title: "Warm clip",
      duration: "0:30",
      views: "20",
      date: "2026-08-21T00:00:00.000Z",
      thumbnailUrl: "https://cdn.test/clip.jpg",
    };
    mocks.videos.mockResolvedValue({ success: true, data: [video] });
    mocks.clips.mockResolvedValue({ success: true, data: [clip] });

    render(<RelatedContent platform="twitch" channelName="testUser" channelData={undefined} />);

    await waitFor(() => {
      expect(mocks.prewarmViewportImages).toHaveBeenCalledWith(
        tab === "home"
          ? [video.thumbnailUrl, clip.thumbnailUrl]
          : [tab === "videos" ? video.thumbnailUrl : clip.thumbnailUrl]
      );
    });
  });
});
