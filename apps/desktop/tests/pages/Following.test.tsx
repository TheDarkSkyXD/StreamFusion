import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fireEvent,
  fixtures,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from "../test-utils";

const storeState = vi.hoisted(() => ({
  twitchConnected: false,
  kickConnected: false,
  localFollows: [] as unknown[],
  currentStream: null as { platform: string; channelName: string } | null,
  repairFollowMetadataFromChannel: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/hooks/queries/useChannels", () => ({
  useFollowedChannels: vi.fn(),
  useChannelByUsername: vi.fn(),
}));

vi.mock("@/hooks/queries/useStreams", () => ({
  useFollowedStreams: vi.fn(),
  useTopStreams: vi.fn(),
  useStreamByChannel: vi.fn(),
}));

vi.mock("@/hooks/queries/useCategories", () => ({
  useTopCategories: vi.fn(),
}));

vi.mock("@/hooks/queries/useFollowedContent", () => ({
  useFollowedVideos: vi.fn(),
  useFollowedClips: vi.fn(),
  useFollowedClipPlayback: vi.fn(),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: () => ({
    twitchConnected: storeState.twitchConnected,
    kickConnected: storeState.kickConnected,
  }),
}));

vi.mock("@/store/follow-store", () => ({
  useFollowStore: <T,>(
    selector?: (state: {
      localFollows: unknown[];
      repairFollowMetadataFromChannel: typeof storeState.repairFollowMetadataFromChannel;
    }) => T
  ) => {
    const state = {
      localFollows: storeState.localFollows,
      repairFollowMetadataFromChannel: storeState.repairFollowMetadataFromChannel,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/store/pip-store", () => ({
  usePipStore: <T,>(selector: (state: { currentStream: typeof storeState.currentStream }) => T) =>
    selector({ currentStream: storeState.currentStream }),
}));

vi.mock("@/components/stream/stream-grid", () => ({
  StreamGrid: ({
    streams,
    isLoading,
    activeStream,
  }: {
    streams?: { channelDisplayName?: string; channelIsVerified?: boolean; title: string }[];
    isLoading?: boolean;
    activeStream?: { platform: string; channelName: string } | null;
  }) => (
    <div data-testid="stream-grid">
      {isLoading ? "loading" : `${streams?.length ?? 0} streams`}
      {activeStream ? ` watching ${activeStream.platform}:${activeStream.channelName}` : null}
      {streams?.map((stream) =>
        stream.channelIsVerified ? (
          <span key={stream.channelDisplayName}>{stream.channelDisplayName} verified</span>
        ) : null
      )}
    </div>
  ),
}));

vi.mock("@/components/discovery/category-grid", () => ({
  CategoryGrid: ({
    categories,
    isLoading,
    imageLoading,
  }: {
    categories?: { id: string; name: string; platform: string }[];
    isLoading?: boolean;
    imageLoading?: "lazy" | "eager";
  }) => (
    <div data-testid="category-grid" data-image-loading={imageLoading}>
      {isLoading ? "loading" : categories?.map((category) => category.name).join(", ")}
    </div>
  ),
}));

vi.mock("@/components/ui/platform-avatar", () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

vi.mock("@/components/stream/related-content/VideoCard", () => ({
  VideoCard: ({ video }: { video: { title: string } }) => (
    <article data-testid="video-card">{video.title}</article>
  ),
}));

vi.mock("@/components/stream/related-content/ClipCard", () => ({
  ClipCard: ({ clip, onClick }: { clip: { title: string }; onClick: () => void }) => (
    <button type="button" data-testid="clip-card" onClick={onClick}>
      {clip.title}
    </button>
  ),
}));

vi.mock("@/components/stream/related-content/ClipDialog", () => ({
  ClipDialog: ({ selectedClip }: { selectedClip: { title: string } | null }) =>
    selectedClip ? <div data-testid="clip-dialog">{selectedClip.title}</div> : null,
}));

import { useTopCategories } from "@/hooks/queries/useCategories";
import { useChannelByUsername, useFollowedChannels } from "@/hooks/queries/useChannels";
import {
  useFollowedClipPlayback,
  useFollowedClips,
  useFollowedVideos,
} from "@/hooks/queries/useFollowedContent";
import { useFollowedStreams } from "@/hooks/queries/useStreams";
import { FollowingPage } from "@/pages/Following";

const useTopCategoriesMock = vi.mocked(useTopCategories);
const useFollowedChannelsMock = vi.mocked(useFollowedChannels);
const useChannelByUsernameMock = vi.mocked(useChannelByUsername);
const useFollowedVideosMock = vi.mocked(useFollowedVideos);
const useFollowedClipsMock = vi.mocked(useFollowedClips);
const useFollowedClipPlaybackMock = vi.mocked(useFollowedClipPlayback);
const useFollowedStreamsMock = vi.mocked(useFollowedStreams);

function installIntersectionObserverMock() {
  const callbacks: IntersectionObserverCallback[] = [];
  const OriginalIntersectionObserver = globalThis.IntersectionObserver;

  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly thresholds: ReadonlyArray<number>;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      callbacks.push(callback);
      this.root = options?.root ?? null;
      this.rootMargin = options?.rootMargin ?? "";
      this.thresholds = Array.isArray(options?.threshold)
        ? options.threshold
        : [options?.threshold ?? 0];
    }

    disconnect = vi.fn();
    observe = vi.fn();
    takeRecords = vi.fn(() => []);
    unobserve = vi.fn();
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

  return {
    restore: () => {
      vi.stubGlobal("IntersectionObserver", OriginalIntersectionObserver);
    },
    trigger: () => {
      callbacks.forEach((callback) =>
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        )
      );
    },
  };
}

// Guards: loading state — render skeleton cards (StreamGrid skeleton + offline-pills skeleton) while Helix and Kick fan-outs are pending, never blank-on-loading
// Guards: error state — Helix or Kick fan-out resolves as error (data=undefined, isLoading=false): the empty-state card surfaces with the "Follow channels to see them here" copy + Browse Channels button; users can route forward
// Guards: empty state — distinct from error; "no follows at all" renders the same empty-state card. Audit punch list flags this triplet as silent-blank-on-Helix-5xx — guarded inline
// Guards: signed-in Kick account state - local app-only Kick follows are hidden while verified account follows render as live/offline rows
// Guards: partnered/verified followed channels keep their platform badge on Following page cards, and live cards receive badge metadata before rendering through StreamGrid
// Guards: mini-player continuity - the currently watched PiP stream identity is forwarded into the live grid so followed live cards can render selected while playback stays in the mini player
// Guards: Videos and Clips tabs aggregate recent content from followed channels instead of rendering unavailable placeholders
// Guards: Videos and Clips tab filters are forwarded into followed-content queries
// Guards: Videos and Clips tabs limit large followed-content lists behind an infinite-scroll sentinel so the page does not render every card at once
// Guards: Categories tab uses the shared category-card grid rather than custom summary cards
// Guards: Categories tab warms category data and first-batch thumbnails before tab activation so followed category cards do not cold-load
describe("FollowingPage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    useTopCategoriesMock.mockReset();
    useFollowedChannelsMock.mockReset();
    useChannelByUsernameMock.mockReset();
    useFollowedVideosMock.mockReset();
    useFollowedClipsMock.mockReset();
    useFollowedClipPlaybackMock.mockReset();
    useFollowedStreamsMock.mockReset();
    storeState.twitchConnected = false;
    storeState.kickConnected = false;
    storeState.localFollows = [];
    storeState.currentStream = null;
    storeState.repairFollowMetadataFromChannel.mockReset();
    useFollowedChannelsMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useFollowedChannels
    >);
    useChannelByUsernameMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useFollowedStreamsMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useFollowedStreams
    >);
    useTopCategoriesMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useTopCategories
    >);
    useFollowedVideosMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useFollowedVideos
    >);
    useFollowedClipsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useFollowedClips
    >);
    useFollowedClipPlaybackMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowedClipPlayback>);
  });

  it("renders the page heading and platform filter buttons", () => {
    renderWithProviders(<FollowingPage />);
    expect(screen.getByRole("heading", { name: /following/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^live$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^videos$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^clips$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^categories$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^channels$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /twitch/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /kick/i })).toBeInTheDocument();
  });

  it("shows empty-state when there are no follows", () => {
    renderWithProviders(<FollowingPage />);
    expect(screen.getByText(/no followed channels found/i)).toBeInTheDocument();
    expect(screen.getByText(/follow channels to see them here/i)).toBeInTheDocument();
  });

  it("shows search-specific empty message when filter has no hits", () => {
    renderWithProviders(<FollowingPage />);
    fireEvent.change(screen.getByPlaceholderText(/search followed channels/i), {
      target: { value: "no-such-channel" },
    });
    expect(screen.getByText(/no matches for "no-such-channel"/i)).toBeInTheDocument();
  });

  it("repairs a stale Kick follow when the user searches the current renamed slug", async () => {
    storeState.localFollows = [
      {
        id: "21103818",
        platform: "kick",
        username: "hennythingz1",
        displayName: "hennythingz1",
        avatarUrl: "",
        bannerUrl: "",
        bio: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    ];
    useChannelByUsernameMock.mockReturnValue({
      data: {
        id: "21103818",
        platform: "kick",
        username: "hennytingzz",
        displayName: "Hennytingzz",
        avatarUrl: "https://files.kick.com/images/user/21103818/profile_image/fullsize.webp",
        bannerUrl: "",
        bio: "",
        isLive: true,
        isVerified: false,
        isPartner: false,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useChannelByUsername>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /kick/i }));
    fireEvent.click(screen.getByRole("button", { name: /^channels$/i }));
    fireEvent.change(screen.getByPlaceholderText(/search followed channels/i), {
      target: { value: "hennytingzz" },
    });

    await waitFor(() => {
      expect(storeState.repairFollowMetadataFromChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "21103818",
          platform: "kick",
          username: "hennytingzz",
        })
      );
    });
  });

  it('loading: forwards isLoading to the streams grid so skeletons render instead of "no followed channels"', () => {
    useFollowedStreamsMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useFollowedStreams
    >);
    renderWithProviders(<FollowingPage />);
    // The mocked StreamGrid prints "loading" when isLoading is forwarded.
    expect(screen.getByTestId("stream-grid")).toHaveTextContent("loading");
    // The empty-state card MUST NOT appear during loading; otherwise the user
    // sees "no follows" before the data arrives.
    expect(screen.queryByText(/no followed channels found/i)).not.toBeInTheDocument();
  });

  it("error: Helix/Kick fan-out fails (data=undefined, isLoading=false) → empty-state card surfaces with Browse Channels CTA", () => {
    // React Query exposes a failed query as { data: undefined, isLoading: false, error }
    // — the page reads only data, so the error path collapses to the empty state.
    useFollowedChannelsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("helix 503"),
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("helix 503"),
    } as unknown as ReturnType<typeof useFollowedStreams>);
    renderWithProviders(<FollowingPage />);
    expect(screen.getByText(/no followed channels found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /browse channels/i })).toBeInTheDocument();
  });

  it("signed-in Kick: shows verified account follows as live and offline, and hides local-only Kick follows", () => {
    storeState.kickConnected = true;
    storeState.localFollows = [
      fixtures.channel({
        id: "local-only",
        platform: "kick",
        username: "localonly",
        displayName: "LocalOnly",
      }),
    ];
    const liveKickFollow = fixtures.channel({
      id: "live-kick",
      platform: "kick",
      username: "livekick",
      displayName: "LiveKick",
    });
    const offlineKickFollow = fixtures.channel({
      id: "offline-kick",
      platform: "kick",
      username: "offlinekick",
      displayName: "OfflineKick",
    });
    useFollowedChannelsMock.mockImplementation(
      (platform) =>
        ({
          data: platform === "kick" ? [liveKickFollow, offlineKickFollow] : [],
          isLoading: false,
        }) as unknown as ReturnType<typeof useFollowedChannels>
    );
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "stream-live-kick",
          platform: "kick",
          channelId: "live-kick",
          channelName: "livekick",
          channelDisplayName: "LiveKick",
          viewerCount: 100,
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);

    expect(screen.getByText(/live now/i)).toBeInTheDocument();
    expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams");
    fireEvent.click(screen.getByRole("button", { name: /^channels$/i }));
    expect(screen.getByRole("heading", { name: /channels/i })).toBeInTheDocument();
    expect(screen.getAllByText("OfflineKick").length).toBeGreaterThan(0);
    expect(screen.queryByText("LocalOnly")).not.toBeInTheDocument();
  });

  it("renders a platform badge beside an offline followed channel card", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "partner-offline",
        username: "partneroffline",
        displayName: "PartnerOffline",
        isPartner: true,
      }),
    ];
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^channels$/i }));

    expect(screen.getAllByText("PartnerOffline").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Twitch verified")).toBeInTheDocument();
  });

  it("passes verified followed-channel metadata into live stream cards", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "verified-live",
        platform: "kick",
        username: "verifiedlive",
        displayName: "VerifiedLive",
        isVerified: true,
      }),
    ];
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "verified-live-stream",
          platform: "kick",
          channelId: "verified-live",
          channelName: "verifiedlive",
          channelDisplayName: "VerifiedLive",
          channelIsVerified: false,
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);

    expect(screen.getByText("VerifiedLive verified")).toBeInTheDocument();
  });

  it("passes the current mini-player stream into the live grid", () => {
    storeState.currentStream = { platform: "kick", channelName: "verifiedlive" };
    storeState.localFollows = [
      fixtures.channel({
        id: "verified-live",
        platform: "kick",
        username: "verifiedlive",
        displayName: "VerifiedLive",
      }),
    ];
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "verified-live-stream",
          platform: "kick",
          channelId: "verified-live",
          channelName: "verifiedlive",
          channelDisplayName: "VerifiedLive",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);

    expect(screen.getByTestId("stream-grid")).toHaveTextContent("watching kick:verifiedlive");
  });

  it("groups live followed streams by category on the Categories tab", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "category-live",
        platform: "twitch",
        username: "categorylive",
        displayName: "CategoryLive",
      }),
    ];
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "category-live-stream",
          platform: "twitch",
          channelId: "category-live",
          channelName: "categorylive",
          channelDisplayName: "CategoryLive",
          categoryId: "just-chatting",
          categoryName: "Just Chatting",
          viewerCount: 42,
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);
    useTopCategoriesMock.mockReturnValue({
      data: [
        fixtures.category({
          id: "just-chatting",
          platform: "twitch",
          name: "Just Chatting",
          boxArtUrl: "https://example.com/just-chatting.jpg",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useTopCategories>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^categories$/i }));

    expect(screen.getByRole("heading", { name: /categories/i })).toBeInTheDocument();
    expect(screen.getByTestId("category-grid")).toHaveTextContent("Just Chatting");
  });

  it("prefetches followed categories and warms category thumbnails before opening the Categories tab", async () => {
    const preloadedUrls: string[] = [];
    class MockImage {
      decoding = "";

      set src(value: string) {
        preloadedUrls.push(value);
      }
    }
    vi.stubGlobal("Image", MockImage);

    storeState.localFollows = [
      fixtures.channel({
        id: "category-live",
        platform: "twitch",
        username: "categorylive",
        displayName: "CategoryLive",
      }),
    ];
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "category-live-stream",
          platform: "twitch",
          channelId: "category-live",
          channelName: "categorylive",
          channelDisplayName: "CategoryLive",
          categoryId: "just-chatting",
          categoryName: "Just Chatting",
          viewerCount: 42,
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);
    useTopCategoriesMock.mockReturnValue({
      data: [
        fixtures.category({
          id: "just-chatting",
          platform: "twitch",
          name: "Just Chatting",
          boxArtUrl: "https://static-cdn.jtvnw.net/ttv-boxart/509658-{width}x{height}.jpg",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useTopCategories>);

    renderWithProviders(<FollowingPage />);

    expect(useTopCategoriesMock).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ enabled: true })
    );
    await waitFor(() =>
      expect(preloadedUrls).toContain("https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg")
    );

    fireEvent.click(screen.getByRole("button", { name: /^categories$/i }));

    expect(screen.getByTestId("category-grid")).toHaveAttribute("data-image-loading", "eager");
  });

  it("shows recent videos from followed channels on the Videos tab", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "video-channel",
        platform: "twitch",
        username: "videochannel",
        displayName: "VideoChannel",
      }),
    ];
    useFollowedVideosMock.mockReturnValue({
      data: [
        {
          id: "video-1",
          platform: "twitch",
          title: "Followed Channel VOD",
          duration: "12:34",
          views: "100",
          date: "2026-06-19T12:00:00.000Z",
          created_at: "2026-06-19T12:00:00.000Z",
          thumbnailUrl: "https://example.com/video.jpg",
          channelSlug: "videochannel",
          channelName: "VideoChannel",
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedVideos>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^videos$/i }));

    expect(screen.getByTestId("video-card")).toHaveTextContent("Followed Channel VOD");
    expect(screen.getByText("Sort by:")).toBeInTheDocument();
    expect(screen.getByText("Most Recent")).toBeInTheDocument();
    expect(useFollowedVideosMock).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ username: "videochannel" })]),
      expect.objectContaining({ enabled: true, sort: "recent" })
    );
    expect(screen.queryByText(/not available on this page yet/i)).not.toBeInTheDocument();
  });

  it("infinite-scrolls followed videos in 24-card batches", () => {
    const observer = installIntersectionObserverMock();
    storeState.localFollows = [
      fixtures.channel({
        id: "video-channel",
        platform: "twitch",
        username: "videochannel",
        displayName: "VideoChannel",
      }),
    ];
    useFollowedVideosMock.mockReturnValue({
      data: Array.from({ length: 25 }, (_, index) => ({
        id: `video-${index}`,
        platform: "twitch",
        title: `Followed Video ${index}`,
        duration: "12:34",
        views: "100",
        date: "2026-06-19T12:00:00.000Z",
        created_at: "2026-06-19T12:00:00.000Z",
        thumbnailUrl: `https://example.com/video-${index}.jpg`,
        channelSlug: "videochannel",
        channelName: "VideoChannel",
      })),
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedVideos>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^videos$/i }));

    expect(screen.getAllByTestId("video-card")).toHaveLength(24);
    expect(screen.getByText("Showing 24 of 25 videos")).toBeInTheDocument();
    expect(screen.queryByText("Followed Video 24")).not.toBeInTheDocument();

    act(() => {
      observer.trigger();
    });

    expect(screen.getAllByTestId("video-card")).toHaveLength(25);
    expect(screen.getByText("Followed Video 0")).toBeInTheDocument();
    expect(screen.getByText("Followed Video 24")).toBeInTheDocument();
    expect(screen.getByText("Showing 25 of 25 videos")).toBeInTheDocument();
    observer.restore();
  });

  it("shows recent clips from followed channels and opens the clip dialog", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "clip-channel",
        platform: "kick",
        username: "clipchannel",
        displayName: "ClipChannel",
      }),
    ];
    useFollowedClipsMock.mockReturnValue({
      data: [
        {
          id: "clip-1",
          platform: "kick",
          title: "Followed Channel Clip",
          duration: "0:30",
          views: "50",
          date: "2026-06-19T12:00:00.000Z",
          created_at: "2026-06-19T12:00:00.000Z",
          thumbnailUrl: "https://example.com/clip.jpg",
          url: "https://example.com/clip.m3u8",
          channelSlug: "clipchannel",
          channelName: "ClipChannel",
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedClips>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^clips$/i }));
    fireEvent.click(screen.getByTestId("clip-card"));

    expect(screen.getByTestId("clip-card")).toHaveTextContent("Followed Channel Clip");
    expect(screen.getByTestId("clip-dialog")).toHaveTextContent("Followed Channel Clip");
    expect(screen.getByText("Filter by:")).toBeInTheDocument();
    expect(screen.getByText("All Time")).toBeInTheDocument();
    expect(screen.getByText("Sort by:")).toBeInTheDocument();
    expect(useFollowedClipsMock).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ username: "clipchannel" })]),
      expect.objectContaining({ enabled: true, sort: "recent", timeRange: "all" })
    );
  });

  it("infinite-scrolls followed clips in 24-card batches", () => {
    const observer = installIntersectionObserverMock();
    storeState.localFollows = [
      fixtures.channel({
        id: "clip-channel",
        platform: "kick",
        username: "clipchannel",
        displayName: "ClipChannel",
      }),
    ];
    useFollowedClipsMock.mockReturnValue({
      data: Array.from({ length: 25 }, (_, index) => ({
        id: `clip-${index}`,
        platform: "kick",
        title: `Followed Clip ${index}`,
        duration: "0:30",
        views: "50",
        date: "2026-06-19T12:00:00.000Z",
        created_at: "2026-06-19T12:00:00.000Z",
        thumbnailUrl: `https://example.com/clip-${index}.jpg`,
        url: `https://example.com/clip-${index}.m3u8`,
        channelSlug: "clipchannel",
        channelName: "ClipChannel",
      })),
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedClips>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^clips$/i }));

    expect(screen.getAllByTestId("clip-card")).toHaveLength(24);
    expect(screen.getByText("Showing 24 of 25 clips")).toBeInTheDocument();
    expect(screen.queryByText("Followed Clip 24")).not.toBeInTheDocument();

    act(() => {
      observer.trigger();
    });

    expect(screen.getAllByTestId("clip-card")).toHaveLength(25);
    expect(screen.getByText("Followed Clip 0")).toBeInTheDocument();
    expect(screen.getByText("Followed Clip 24")).toBeInTheDocument();
    expect(screen.getByText("Showing 25 of 25 clips")).toBeInTheDocument();
    observer.restore();
  });
});
