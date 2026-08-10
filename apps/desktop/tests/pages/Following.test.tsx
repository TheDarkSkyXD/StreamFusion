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
  authInitialized: true,
  followsHydrated: true,
  twitchUserId: "guest",
  kickUserId: "guest",
  localFollows: [] as unknown[],
  currentStream: null as { platform: string; channelName: string } | null,
  repairFollowMetadataFromChannel: vi.fn(),
  syncConnectedFollows: vi.fn(async () => ({ synced: [] as string[], failed: [] as string[] })),
  followSyncInProgress: false,
  followSyncLastSyncedAt: {} as Partial<Record<"twitch" | "kick", string>>,
}));

const firstPaintState = vi.hoisted(() => ({ hasPainted: true }));

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/hooks/queries/useChannels", () => ({
  useFollowedChannels: vi.fn(),
  useChannelByUsername: vi.fn(),
}));

vi.mock("@/hooks/queries/useStreams", () => ({
  createFollowedStreamSnapshotIdentity: vi.fn(
    (platform, twitchUserId, kickUserId, follows: Array<{ platform: string; id: string }>) => ({
      platform: platform ?? "all",
      twitchUserId,
      kickUserId,
      follows: follows.map((follow) => `${follow.platform}:${follow.id}`).sort(),
    })
  ),
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

vi.mock("@/hooks/useAfterFirstPaint", () => ({
  useAfterFirstPaint: () => firstPaintState.hasPainted,
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: () => ({
    twitchConnected: storeState.twitchConnected,
    kickConnected: storeState.kickConnected,
    initialized: storeState.authInitialized,
    twitchUser: storeState.twitchUserId === "guest" ? null : { id: storeState.twitchUserId },
    kickUser: storeState.kickUserId === "guest" ? null : { id: storeState.kickUserId },
    syncConnectedFollows: storeState.syncConnectedFollows,
    followSyncInProgress: storeState.followSyncInProgress,
    followSyncLastSyncedAt: storeState.followSyncLastSyncedAt,
  }),
}));

vi.mock("@/store/follow-store", () => ({
  useFollowStore: <T,>(
    selector?: (state: {
      localFollows: unknown[];
      isHydrated: boolean;
      repairFollowMetadataFromChannel: typeof storeState.repairFollowMetadataFromChannel;
    }) => T
  ) => {
    const state = {
      localFollows: storeState.localFollows,
      isHydrated: storeState.followsHydrated,
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
    skeletons,
    activeStream,
  }: {
    streams?: { channelDisplayName?: string; channelIsVerified?: boolean; title: string }[];
    isLoading?: boolean;
    skeletons?: number;
    activeStream?: { platform: string; channelName: string } | null;
  }) => (
    <div data-testid="stream-grid" data-skeleton-count={skeletons}>
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

import {
  getCachePerformanceSamples,
  resetCachePerformanceSamples,
} from "@/hooks/queries/cache-performance";
import { useTopCategories } from "@/hooks/queries/useCategories";
import { useChannelByUsername, useFollowedChannels } from "@/hooks/queries/useChannels";
import {
  useFollowedClipPlayback,
  useFollowedClips,
  useFollowedVideos,
} from "@/hooks/queries/useFollowedContent";
import {
  createFollowedStreamSnapshotIdentity,
  useFollowedStreams,
} from "@/hooks/queries/useStreams";
import { FollowingPage } from "@/pages/Following";

const useTopCategoriesMock = vi.mocked(useTopCategories);
const useFollowedChannelsMock = vi.mocked(useFollowedChannels);
const useChannelByUsernameMock = vi.mocked(useChannelByUsername);
const useFollowedVideosMock = vi.mocked(useFollowedVideos);
const useFollowedClipsMock = vi.mocked(useFollowedClips);
const useFollowedClipPlaybackMock = vi.mocked(useFollowedClipPlayback);
const useFollowedStreamsMock = vi.mocked(useFollowedStreams);
const createFollowedStreamSnapshotIdentityMock = vi.mocked(createFollowedStreamSnapshotIdentity);

function installIntersectionObserverMock() {
  const callbacks: IntersectionObserverCallback[] = [];
  const OriginalIntersectionObserver = globalThis.IntersectionObserver;

  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly scrollMargin = "";
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

function createManualRefreshFixture(prefix: string, firstCategoryName?: string) {
  const firstChannel = fixtures.channel({
    id: `${prefix}-channel-1`,
    platform: "twitch",
    username: `${prefix}one`,
    displayName: `${prefix} One`,
  });
  const secondChannel = fixtures.channel({
    id: `${prefix}-channel-2`,
    platform: "kick",
    username: `${prefix}two`,
    displayName: `${prefix} Two`,
  });
  const firstStream = fixtures.stream({
    id: `${prefix}-stream-1`,
    platform: "twitch",
    channelId: firstChannel.id,
    channelName: firstChannel.username,
    channelDisplayName: firstChannel.displayName,
    categoryName: firstCategoryName,
  });
  const secondStream = fixtures.stream({
    id: `${prefix}-stream-2`,
    platform: "kick",
    channelId: secondChannel.id,
    channelName: secondChannel.username,
    channelDisplayName: secondChannel.displayName,
  });

  return { firstChannel, firstStream, secondChannel, secondStream };
}

function createDeferredRefresh() {
  let resolve!: (result: { isError: false; status: "success" }) => void;
  const promise = new Promise<{ isError: false; status: "success" }>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

// Guards: loading state — render skeleton cards (StreamGrid skeleton + offline-pills skeleton) while Helix and Kick fan-outs are pending, never blank-on-loading
// Guards: error state — a failed Following request presents a retryable error alert, never the empty state.
// Guards: empty state — a successfully settled zero-result request presents the explicit no-followed-channels state.
// Guards: signed-in Kick account state - SQLite follows remain visible while remote follows enrich matching rows and add live/offline rows
// Guards: partnered/verified followed channels keep their platform badge on Following page cards, and live cards receive badge metadata before rendering through StreamGrid
// Guards: mini-player continuity - the currently watched PiP stream identity is forwarded into the live grid so followed live cards can render selected while playback stays in the mini player
// Guards: Videos and Clips tabs aggregate recent content from followed channels instead of rendering unavailable placeholders
// Guards: Videos and Clips tab filters are forwarded into followed-content queries
// Guards: Videos and Clips tabs limit large followed-content lists behind an infinite-scroll sentinel so the page does not render every card at once
// Guards: Categories tab uses the shared category-card grid rather than custom summary cards
// Guards: Categories tab warms category data and first-batch thumbnails before tab activation so followed category cards do not cold-load
// Guards: delayed startup keeps live refresh active but defers exact snapshot identity work until auth, follows, and the first paint are ready
// Guards: first useful paint derives the deduped cached live count without mounting cards, skeletons, or a false empty state
// Guards: Live-tab startup does not prepare the full followed-channel collection for disabled Videos and Clips queries
// Guards: one manual Live refresh dispatches exactly one current streams/channels refresh without account-sync or unrelated-tab fan-out
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
    createFollowedStreamSnapshotIdentityMock.mockClear();
    storeState.twitchConnected = false;
    storeState.kickConnected = false;
    storeState.authInitialized = true;
    storeState.followsHydrated = true;
    storeState.twitchUserId = "guest";
    storeState.kickUserId = "guest";
    storeState.localFollows = [];
    storeState.currentStream = null;
    storeState.repairFollowMetadataFromChannel.mockReset();
    storeState.syncConnectedFollows.mockReset();
    storeState.syncConnectedFollows.mockResolvedValue({ synced: [], failed: [] });
    storeState.followSyncInProgress = false;
    storeState.followSyncLastSyncedAt = {};
    firstPaintState.hasPainted = true;
    resetCachePerformanceSamples();
    useFollowedChannelsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useChannelByUsernameMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useFollowedStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowedStreams>);
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

  it("defers followed-content channel lists until their tab is selected", () => {
    storeState.localFollows = Array.from({ length: 100 }, (_, index) =>
      fixtures.channel({
        id: `channel-${index}`,
        username: `channel${index}`,
        displayName: `Channel ${index}`,
      })
    );

    renderWithProviders(<FollowingPage />);

    expect(useFollowedVideosMock).toHaveBeenLastCalledWith([], {
      enabled: false,
      sort: "recent",
    });
    expect(useFollowedClipsMock).toHaveBeenLastCalledWith([], {
      enabled: false,
      sort: "recent",
      timeRange: "all",
    });

    fireEvent.click(screen.getByRole("button", { name: /^videos$/i }));

    expect(useFollowedVideosMock).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "channel-0" }),
        expect.objectContaining({ id: "channel-99" }),
      ]),
      { enabled: true, sort: "recent" }
    );
    expect(useFollowedVideosMock.mock.lastCall?.[0]).toHaveLength(100);
  });

  // Guards: the combined live-status query polls only while the Following Live tab is active.
  it("pauses followed live-status polling outside the Live tab", () => {
    renderWithProviders(<FollowingPage />);

    expect(useFollowedStreamsMock).toHaveBeenLastCalledWith(
      undefined,
      20,
      expect.objectContaining({ enabled: true })
    );

    fireEvent.click(screen.getByRole("button", { name: /^channels$/i }));

    expect(useFollowedStreamsMock).toHaveBeenLastCalledWith(
      undefined,
      20,
      expect.objectContaining({ enabled: false })
    );
  });

  it("binds followed-stream persistence to the exact account and local follow set", () => {
    storeState.twitchUserId = "viewer-1";
    storeState.localFollows = [fixtures.channel({ id: "channel-1", platform: "twitch" })];

    renderWithProviders(<FollowingPage />);

    expect(useFollowedStreamsMock).toHaveBeenCalledWith(undefined, 20, {
      enabled: true,
      snapshotIdentity: {
        platform: "all",
        twitchUserId: "viewer-1",
        kickUserId: "guest",
        follows: ["twitch:channel-1"],
      },
    });
  });

  it("keeps the prepaint live query active without building its snapshot identity", () => {
    storeState.twitchUserId = "viewer-1";
    storeState.localFollows = [fixtures.channel({ id: "channel-1", platform: "twitch" })];
    firstPaintState.hasPainted = false;

    const view = renderWithProviders(<FollowingPage />);

    expect(createFollowedStreamSnapshotIdentityMock).not.toHaveBeenCalled();
    expect(useFollowedStreamsMock).toHaveBeenLastCalledWith(undefined, 20, {
      enabled: true,
      snapshotIdentity: undefined,
    });

    firstPaintState.hasPainted = true;
    view.rerender(<FollowingPage />);

    expect(createFollowedStreamSnapshotIdentityMock).toHaveBeenCalledWith(
      undefined,
      "viewer-1",
      "guest",
      storeState.localFollows
    );
    expect(useFollowedStreamsMock).toHaveBeenLastCalledWith(undefined, 20, {
      enabled: true,
      snapshotIdentity: {
        platform: "all",
        twitchUserId: "viewer-1",
        kickUserId: "guest",
        follows: ["twitch:channel-1"],
      },
    });
  });

  it("waits for auth and follows hydration before allowing followed-stream persistence", () => {
    storeState.authInitialized = false;
    storeState.followsHydrated = false;

    const view = renderWithProviders(<FollowingPage />);

    expect(useFollowedStreamsMock).toHaveBeenLastCalledWith(undefined, 20, {
      enabled: true,
      snapshotIdentity: undefined,
    });

    storeState.authInitialized = true;
    storeState.twitchUserId = "viewer-after-startup";
    storeState.localFollows = [fixtures.channel({ id: "hydrated-follow", platform: "twitch" })];
    view.rerender(<FollowingPage />);
    expect(useFollowedStreamsMock).toHaveBeenLastCalledWith(undefined, 20, {
      enabled: true,
      snapshotIdentity: undefined,
    });

    storeState.followsHydrated = true;
    view.rerender(<FollowingPage />);
    expect(useFollowedStreamsMock).toHaveBeenLastCalledWith(undefined, 20, {
      enabled: true,
      snapshotIdentity: {
        platform: "all",
        twitchUserId: "viewer-after-startup",
        kickUserId: "guest",
        follows: ["twitch:hydrated-follow"],
      },
    });
  });

  it("manual refresh dispatch is measured without showing global refresh copy", async () => {
    const refetchFollowedStreams = vi.fn().mockResolvedValue({ isError: false, status: "success" });
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: refetchFollowedStreams,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /refresh following data/i }));

    await waitFor(() => {
      expect(refetchFollowedStreams).toHaveBeenCalledTimes(1);
    });
    expect(getCachePerformanceSamples("cache-invalidation")).toEqual([
      expect.objectContaining({
        surface: "manual-refresh:following",
        withinBudget: true,
      }),
    ]);
    expect(screen.queryByText(/refreshing cache|refreshing data/i)).not.toBeInTheDocument();
  });

  it("manual Live refresh requests current streams and channels exactly once", async () => {
    storeState.twitchConnected = true;
    storeState.kickConnected = true;
    const refetchFollowedStreams = vi.fn().mockResolvedValue({ isError: false, status: "success" });
    const refetchTwitchFollows = vi.fn().mockResolvedValue({ isError: false, status: "success" });
    const refetchKickFollows = vi.fn().mockResolvedValue({ isError: false, status: "success" });
    const refetchCategories = vi.fn().mockResolvedValue({ isError: false, status: "success" });
    const refetchVideos = vi.fn().mockResolvedValue({ isError: false, status: "success" });
    const refetchClips = vi.fn().mockResolvedValue({ isError: false, status: "success" });
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: refetchFollowedStreams,
    } as unknown as ReturnType<typeof useFollowedStreams>);
    useFollowedChannelsMock.mockImplementation(
      (platform) =>
        ({
          data: [],
          isLoading: false,
          refetch: platform === "twitch" ? refetchTwitchFollows : refetchKickFollows,
        }) as unknown as ReturnType<typeof useFollowedChannels>
    );
    useTopCategoriesMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: refetchCategories,
    } as unknown as ReturnType<typeof useTopCategories>);
    useFollowedVideosMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: refetchVideos,
    } as unknown as ReturnType<typeof useFollowedVideos>);
    useFollowedClipsMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: refetchClips,
    } as unknown as ReturnType<typeof useFollowedClips>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /refresh following data/i }));

    await waitFor(() => {
      expect(refetchFollowedStreams).toHaveBeenCalledTimes(1);
    });
    expect(refetchTwitchFollows).toHaveBeenCalledTimes(1);
    expect(refetchKickFollows).toHaveBeenCalledTimes(1);
    expect(storeState.syncConnectedFollows).not.toHaveBeenCalled();
    expect(refetchCategories).not.toHaveBeenCalled();
    expect(refetchVideos).not.toHaveBeenCalled();
    expect(refetchClips).not.toHaveBeenCalled();
  });

  it("manual Live refresh preserves cached cards, publishes success, and resets pending", async () => {
    const { firstChannel, firstStream, secondChannel, secondStream } = createManualRefreshFixture(
      "refresh",
      "Just Chatting"
    );
    storeState.localFollows = [firstChannel, secondChannel];
    let visibleStreams = [firstStream];
    const refresh = createDeferredRefresh();
    const refreshPromise = refresh.promise;
    const refetchFollowedStreams = vi.fn(() => refreshPromise);
    const refetchCategories = vi.fn().mockResolvedValue({ isError: false, status: "success" });
    useFollowedStreamsMock.mockImplementation(
      () =>
        ({
          data: visibleStreams,
          isLoading: false,
          refetch: refetchFollowedStreams,
        }) as unknown as ReturnType<typeof useFollowedStreams>
    );
    useTopCategoriesMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: refetchCategories,
    } as unknown as ReturnType<typeof useTopCategories>);

    const view = renderWithProviders(<FollowingPage />);
    const refreshButton = screen.getByRole("button", { name: /refresh following data/i });
    fireEvent.click(refreshButton);

    expect(refreshButton).toBeDisabled();
    expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams");
    expect(refetchFollowedStreams).toHaveBeenCalledTimes(1);
    expect(refetchCategories).not.toHaveBeenCalled();

    visibleStreams = [firstStream, secondStream];
    await act(async () => {
      refresh.resolve({ isError: false, status: "success" });
      await refreshPromise;
    });
    view.rerender(<FollowingPage />);

    expect(screen.getByTestId("stream-grid")).toHaveTextContent("2 streams");
    expect(refreshButton).toBeEnabled();
  });

  it("failed manual Live refresh keeps cached cards and Retry recovers", async () => {
    const { firstChannel, firstStream, secondChannel, secondStream } =
      createManualRefreshFixture("retry");
    storeState.localFollows = [firstChannel, secondChannel];
    let visibleStreams = [firstStream];
    const retry = createDeferredRefresh();
    const retryPromise = retry.promise;
    const refetchFollowedStreams = vi
      .fn()
      .mockResolvedValueOnce({ isError: true, status: "error" })
      .mockImplementationOnce(() => retryPromise);
    useFollowedStreamsMock.mockImplementation(
      () =>
        ({
          data: visibleStreams,
          isLoading: false,
          refetch: refetchFollowedStreams,
        }) as unknown as ReturnType<typeof useFollowedStreams>
    );

    const view = renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh following data" }));

    const retryButton = await screen.findByRole("button", {
      name: "Retry refreshing following data",
    });
    expect(retryButton).toBeEnabled();
    expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams");
    expect(screen.queryByText(/no live followed channels found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no followed channels found/i)).not.toBeInTheDocument();

    fireEvent.click(retryButton);
    expect(retryButton).toBeDisabled();
    expect(refetchFollowedStreams).toHaveBeenCalledTimes(2);

    visibleStreams = [firstStream, secondStream];
    await act(async () => {
      retry.resolve({ isError: false, status: "success" });
      await retryPromise;
    });
    view.rerender(<FollowingPage />);

    expect(screen.getByTestId("stream-grid")).toHaveTextContent("2 streams");
    expect(screen.getByRole("button", { name: "Refresh following data" })).toBeEnabled();
  });

  it("shows per-platform follow-sync freshness", () => {
    storeState.twitchConnected = true;
    storeState.kickConnected = true;
    storeState.followSyncLastSyncedAt = {
      twitch: "2026-07-02T15:00:00.000Z",
      kick: "2026-07-02T15:05:00.000Z",
    };

    renderWithProviders(<FollowingPage />);

    expect(screen.getByText(/twitch synced/i)).toBeInTheDocument();
    expect(screen.getByText(/kick synced/i)).toBeInTheDocument();
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

  it("looks up the current Kick channel when a renamed follow search has no local match", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /^channels$/i }));
    fireEvent.change(screen.getByPlaceholderText(/search followed channels/i), {
      target: { value: "hennytingzz" },
    });

    await waitFor(() => {
      expect(useChannelByUsernameMock).toHaveBeenCalledWith("hennytingzz", "kick");
    });
  });

  it("dedupes duplicate Kick channel rows with the same slug on the Channels tab", () => {
    storeState.localFollows = [
      {
        id: "channel-1",
        platform: "kick",
        username: "hennytingzz",
        displayName: "hennytingzz",
        avatarUrl: "",
        bannerUrl: "",
        bio: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
      {
        id: "user-21103818",
        platform: "kick",
        username: "Hennytingzz",
        displayName: "Hennytingzz",
        avatarUrl: "https://example.com/hennytingzz.webp",
        bannerUrl: "",
        bio: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      },
    ];

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^channels$/i }));
    fireEvent.change(screen.getByPlaceholderText(/search followed channels/i), {
      target: { value: "henny" },
    });

    expect(screen.getByText(/\(1\)/)).toBeInTheDocument();
    expect(screen.getAllByTestId("avatar")).toHaveLength(1);
  });

  it("loading: shows an accessible 12-card skeleton grid until an empty initial request settles", () => {
    useFollowedStreamsMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useFollowedStreams
    >);
    const view = renderWithProviders(<FollowingPage />);

    expect(screen.getByRole("status", { name: /loading followed content/i })).toBeInTheDocument();
    expect(screen.getByTestId("stream-grid")).toHaveTextContent("loading");
    expect(screen.getByTestId("stream-grid")).toHaveAttribute("data-skeleton-count", "12");
    expect(screen.queryByText(/no followed channels found/i)).not.toBeInTheDocument();

    useFollowedStreamsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useFollowedStreams
    >);
    view.rerender(<FollowingPage />);

    expect(
      screen.queryByRole("status", { name: /loading followed content/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("stream-grid")).not.toBeInTheDocument();
    expect(screen.getByText(/no followed channels found/i)).toBeInTheDocument();
  });

  it("loading: shows 12 placeholders while a visible local follow awaits initial live status", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "local-awaiting-status",
        platform: "twitch",
        username: "awaitingstatus",
        displayName: "Awaiting Status",
      }),
    ];
    useFollowedStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);

    expect(screen.getByRole("status", { name: /loading followed content/i })).toBeInTheDocument();
    expect(screen.getByTestId("stream-grid")).toHaveAttribute("data-skeleton-count", "12");
    expect(screen.queryByText(/no live followed channels found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no followed channels found/i)).not.toBeInTheDocument();
  });

  // Guards: cached live cards stay visible through a background refresh instead of flashing a skeleton grid.
  it("background refresh: keeps cached live cards visible instead of replacing them with skeletons", () => {
    const channel = fixtures.channel({
      id: "cached-live-channel",
      platform: "twitch",
      username: "cachedlive",
      displayName: "Cached Live",
    });
    storeState.localFollows = [channel];
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "cached-live-stream",
          platform: "twitch",
          channelId: channel.id,
          channelName: channel.username,
          channelDisplayName: channel.displayName,
        }),
      ],
      isLoading: false,
      isFetching: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);

    expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams");
    expect(
      screen.queryByRole("status", { name: /loading followed content/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/no live followed channels found/i)).not.toBeInTheDocument();
  });

  it("shows connected Kick SQLite follows while remote follows and live status refresh", () => {
    storeState.kickConnected = true;
    storeState.localFollows = [
      fixtures.channel({
        id: "local-kick",
        platform: "kick",
        username: "localpending",
        displayName: "LocalPending",
      }),
    ];
    useFollowedChannelsMock.mockImplementation(
      (platform) =>
        ({
          data: platform === "kick" ? undefined : [],
          isLoading: platform === "kick",
          refetch: vi.fn(),
        }) as unknown as ReturnType<typeof useFollowedChannels>
    );
    useFollowedStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^channels$/i }));

    expect(screen.getAllByText("LocalPending").length).toBeGreaterThan(0);
    expect(useFollowedChannelsMock).toHaveBeenCalledWith("kick", { enabled: true });
  });

  it("error: keeps an initial query failure distinct from the empty state and retries", async () => {
    const refetchFollowedStreams = vi.fn().mockResolvedValue({ isError: false, status: "success" });
    useFollowedStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("network unavailable"),
      refetch: refetchFollowedStreams,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load followed channels/i);
    fireEvent.click(screen.getByRole("button", { name: /retry loading followed content/i }));

    await waitFor(() => expect(refetchFollowedStreams).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/no followed channels found/i)).not.toBeInTheDocument();
  });

  it("error: offers Retry when a visible local follow has no initial live-status data", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "local-status-failed",
        platform: "kick",
        username: "statusfailed",
        displayName: "Status Failed",
      }),
    ];
    useFollowedStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("live status unavailable"),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load followed channels/i);
    expect(
      screen.getByRole("button", { name: /retry loading followed content/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/no live followed channels found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no followed channels found/i)).not.toBeInTheDocument();
  });

  it("keeps connected Kick SQLite follows when the remote refresh resolves empty", () => {
    storeState.kickConnected = true;
    storeState.localFollows = [
      fixtures.channel({
        id: "local-kick",
        platform: "kick",
        username: "localresolved",
        displayName: "LocalResolved",
      }),
    ];
    useFollowedChannelsMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<FollowingPage />);
    fireEvent.click(screen.getByRole("button", { name: /^channels$/i }));

    expect(screen.getAllByText("LocalResolved").length).toBeGreaterThan(0);
    expect(screen.queryByText(/no followed channels found/i)).not.toBeInTheDocument();
  });

  it("error: Helix/Kick fan-out failure renders retry instead of the empty state", () => {
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
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load followed channels/i);
    expect(
      screen.getByRole("button", { name: /retry loading followed content/i })
    ).toBeInTheDocument();
  });

  it("signed-in Kick: merges SQLite follows with verified account follows", () => {
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
    expect(screen.getAllByText("LocalOnly").length).toBeGreaterThan(0);
  });

  it("shows the full live count before first paint without mounting the stream grid", () => {
    const channels = Array.from({ length: 12 }, (_, index) =>
      fixtures.channel({
        id: `live-channel-${index}`,
        username: `livechannel${index}`,
        displayName: `Live Channel ${index}`,
      })
    );
    storeState.localFollows = channels;
    useFollowedStreamsMock.mockReturnValue({
      data: channels.map((channel, index) =>
        fixtures.stream({
          id: `live-stream-${index}`,
          channelId: channel.id,
          channelName: channel.username,
          channelDisplayName: channel.displayName,
          viewerCount: 12 - index,
        })
      ),
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);
    firstPaintState.hasPainted = false;

    const view = renderWithProviders(<FollowingPage />);

    expect(screen.getByRole("heading", { name: /live now/i })).toHaveTextContent("(12)");
    expect(screen.queryByTestId("stream-grid")).not.toBeInTheDocument();
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
    expect(screen.queryByText(/no live followed channels found/i)).not.toBeInTheDocument();

    firstPaintState.hasPainted = true;
    view.rerender(<FollowingPage />);

    expect(screen.getByTestId("stream-grid")).toHaveTextContent("12 streams");
  });

  it("uses cached followed streams for the deduped prepaint live count", () => {
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "cached-stream-1",
          channelId: "cached-channel-1",
          channelName: "cachedchannel1",
          viewerCount: 10,
        }),
        fixtures.stream({
          id: "cached-stream-1-duplicate",
          channelId: "cached-channel-1",
          channelName: "cachedchannel1",
          viewerCount: 20,
        }),
        fixtures.stream({
          id: "cached-stream-2",
          channelId: "cached-channel-2",
          channelName: "cachedchannel2",
          viewerCount: 5,
        }),
      ],
      isLoading: true,
    } as unknown as ReturnType<typeof useFollowedStreams>);
    firstPaintState.hasPainted = false;

    renderWithProviders(<FollowingPage />);

    expect(screen.getByRole("heading", { name: /live now/i })).toHaveTextContent("(2)");
    expect(screen.queryByTestId("stream-grid")).not.toBeInTheDocument();
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
    expect(screen.queryByText(/no followed channels found/i)).not.toBeInTheDocument();
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
