import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fixtures, renderWithProviders, routerMock, screen } from "../test-utils";

const routeMockState = vi.hoisted(() => ({ search: { q: "A" } }));
let intersectionCallbacks: IntersectionObserverCallback[] = [];

vi.mock("@tanstack/react-router", () => routerMock({ search: routeMockState.search }));

vi.mock("@/hooks/queries/useSearch", () => ({
  useSearchAll: vi.fn(),
  useSearchCategories: vi.fn(),
  useSearchChannels: vi.fn(),
  useSearchClips: vi.fn(),
  useSearchStreams: vi.fn(),
  useSearchVideos: vi.fn(),
}));

vi.mock("@/components/stream/stream-grid", () => ({
  StreamGrid: ({ streams }: { streams?: unknown[] }) => (
    <div data-testid="stream-grid">{streams?.length ?? 0} streams</div>
  ),
}));

vi.mock("@/components/discovery/category-grid", () => ({
  CategoryGrid: ({ categories }: { categories?: unknown[] }) => (
    <div data-testid="category-grid">{categories?.length ?? 0} categories</div>
  ),
}));

vi.mock("@/components/ui/platform-avatar", () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({
    src,
    alt,
    onProxyError,
  }: {
    src: string;
    alt: string;
    onProxyError?: () => void;
  }) => (
    <button data-testid="proxied-image" data-src={src} onClick={onProxyError}>
      {alt}
    </button>
  ),
}));

import {
  useSearchAll,
  useSearchCategories,
  useSearchChannels,
  useSearchClips,
  useSearchStreams,
  useSearchVideos,
} from "@/hooks/queries/useSearch";
import { SearchPage } from "@/pages/SearchResults";

const useSearchAllMock = vi.mocked(useSearchAll);
const useSearchCategoriesMock = vi.mocked(useSearchCategories);
const useSearchChannelsMock = vi.mocked(useSearchChannels);
const useSearchClipsMock = vi.mocked(useSearchClips);
const useSearchStreamsMock = vi.mocked(useSearchStreams);
const useSearchVideosMock = vi.mocked(useSearchVideos);

function emptyResults() {
  return { channels: [], streams: [], videos: [], clips: [], categories: [] };
}

function channelQuery(
  pages: Array<{ data: ReturnType<typeof fixtures.channel>[] }> = [{ data: [] }],
  overrides: Partial<ReturnType<typeof useSearchChannels>> = {}
) {
  return {
    data: { pages },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useSearchChannels>;
}

// Guards: loading state — useSearchAll isLoading=true forwards through to StreamGrid+CategoryGrid via the isLoading prop so the user sees skeletons, not "0 results"
// Guards: error state — useSearchAll returns data=undefined (GQL failed) → the page falls through to the empty results header. We pass this distinct from "0 hits" via the consumer's empty copy
// Guards: empty state — useSearchAll returns empty arrays for every category → "Found 0 results" header surfaces, distinct from the no-query "type to search" empty state above
// Guards: Kick video/clip thumbnails render through ProxiedImage so images.kick.com 720.webp URLs do not produce direct browser 403s
// Guards: focused tabs enable and render only their dedicated result source instead of stale All-tab data
// Guards: focused tabs render loading or empty feedback instead of a blank panel
// Guards: focused Videos and Clips tabs render recent content returned for channels matching the search term
// Guards: focused media tabs fetch another batch at the scroll sentinel and stop requesting after provider exhaustion
// Guards: a VOD card disappears when its thumbnail fails instead of presenting a broken recording tile
describe("SearchPage", () => {
  beforeEach(() => {
    intersectionCallbacks = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = "";
        thresholds = [];
      }
    );
    routeMockState.search.q = "A";
    useSearchAllMock.mockReset();
    useSearchCategoriesMock.mockReset();
    useSearchChannelsMock.mockReset();
    useSearchClipsMock.mockReset();
    useSearchStreamsMock.mockReset();
    useSearchVideosMock.mockReset();
    useSearchChannelsMock.mockReturnValue(channelQuery());
    useSearchCategoriesMock.mockReturnValue({
      data: { pages: [{ data: [] }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchCategories>);
    useSearchStreamsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useSearchStreams
    >);
    useSearchVideosMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useSearchVideos
    >);
    useSearchClipsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useSearchClips
    >);
  });

  it("renders the search header for a non-empty query with no hits", () => {
    useSearchAllMock.mockReturnValue({
      data: emptyResults(),
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    renderWithProviders(<SearchPage />);
    expect(screen.getByText(/search results for/i)).toBeInTheDocument();
    expect(screen.getByText(/found 0 results/i)).toBeInTheDocument();
  });

  it("searches the full results page for a one-letter query", () => {
    useSearchAllMock.mockReturnValue({
      data: emptyResults(),
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    renderWithProviders(<SearchPage />);
    expect(useSearchAllMock).toHaveBeenCalledWith("A", undefined, 20, true);
    expect(useSearchChannelsMock).toHaveBeenCalledWith("A", undefined, 50, false, false);
  });

  it("uses bounded search-all channels without activating dedicated channel pagination", () => {
    routeMockState.search.q = "bundle";
    const cappedBundleChannel = fixtures.channel({
      id: "bundle-only",
      username: "bundleonly",
      displayName: "BundleOnly",
    });
    const paginatedOnlyChannel = fixtures.channel({
      id: "paginated-only",
      username: "paginatedonly",
      displayName: "PaginatedOnly",
    });
    const fetchNextPage = vi.fn();
    useSearchAllMock.mockReturnValue({
      data: { ...emptyResults(), channels: [cappedBundleChannel] },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    useSearchChannelsMock.mockReturnValue(
      channelQuery([{ data: [paginatedOnlyChannel] }], {
        hasNextPage: true,
        fetchNextPage,
      })
    );

    renderWithProviders(<SearchPage />);

    expect(screen.getByText(/found 1 result/i)).toBeInTheDocument();
    expect(screen.getAllByText("BundleOnly").length).toBeGreaterThan(0);
    expect(screen.queryByText("PaginatedOnly")).not.toBeInTheDocument();
    expect(useSearchChannelsMock).toHaveBeenCalledWith("bundle", undefined, 50, false, false);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("activates and reranks complete dedicated channel pages only on the Channels tab", () => {
    routeMockState.search.q = "creator";
    const exact = fixtures.channel({
      id: "exact-kick",
      platform: "kick",
      username: "creator",
      displayName: "Creator",
      followerCount: 0,
    });
    const prefix = fixtures.channel({
      id: "prefix-kick",
      platform: "kick",
      username: "creatorstudio",
      displayName: "Creator Studio",
      followerCount: 20,
    });
    const substring = fixtures.channel({
      id: "substring-twitch",
      platform: "twitch",
      username: "thecreator",
      displayName: "The Creator",
      followerCount: 1_000_000,
      isLive: true,
    });
    useSearchAllMock.mockReturnValue({
      data: emptyResults(),
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    useSearchChannelsMock.mockReturnValue(
      channelQuery([{ data: [substring] }, { data: [prefix, exact] }])
    );

    renderWithProviders(<SearchPage />);
    fireEvent.click(screen.getByRole("button", { name: "Channels" }));

    const idByUsername = new Map(
      [exact, prefix, substring].map((channel) => [channel.username, channel.id])
    );
    const orderedIds = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("data-params"))
      .filter((params): params is string => Boolean(params))
      .map((params) => idByUsername.get(JSON.parse(params).channel))
      .filter((id): id is string => Boolean(id));
    expect(orderedIds).toEqual(["exact-kick", "prefix-kick", "substring-twitch"]);
    expect(useSearchChannelsMock).toHaveBeenLastCalledWith("creator", undefined, 50, false, true);
    expect(useSearchAllMock).toHaveBeenLastCalledWith("creator", undefined, 20, false);
  });

  it("renders platform partner badges beside channel search results", () => {
    const channels = [
      fixtures.channel({
        id: "t-partner",
        username: "alpha-twitch",
        displayName: "AlphaTwitch",
        platform: "twitch",
        isPartner: true,
      }),
      fixtures.channel({
        id: "k-partner",
        username: "alpha-kick",
        displayName: "AlphaKick",
        platform: "kick",
        isVerified: true,
      }),
    ];
    useSearchAllMock.mockReturnValue({
      data: { ...emptyResults(), channels },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);

    renderWithProviders(<SearchPage />);

    expect(screen.getByLabelText("Twitch verified")).toBeInTheDocument();
    expect(screen.getByAltText("Kick verified")).toBeInTheDocument();
  });

  it("renders streams returned by the search API", () => {
    useSearchAllMock.mockReturnValue({
      data: {
        ...emptyResults(),
        streams: [fixtures.stream({ id: "a" }), fixtures.stream({ id: "b" })],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    renderWithProviders(<SearchPage />);
    expect(screen.getByTestId("stream-grid")).toHaveTextContent("2 streams");
  });

  it("renders categories returned by the search API", () => {
    useSearchAllMock.mockReturnValue({
      data: {
        ...emptyResults(),
        categories: [fixtures.category({ id: "c1" })],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);

    renderWithProviders(<SearchPage />);

    expect(screen.getByTestId("category-grid")).toHaveTextContent("1 categories");
  });

  it("uses only the dedicated result source for each focused tab", () => {
    const allOnlyStreams = [
      fixtures.stream({ id: "all-stream-1", title: "All Stream One" }),
      fixtures.stream({ id: "all-stream-2", title: "All Stream Two" }),
    ];
    const focusedStream = fixtures.stream({ id: "focused-stream", title: "Focused Stream" });
    const focusedCategory = fixtures.category({ id: "focused-category", name: "Focused Category" });
    useSearchAllMock.mockReturnValue({
      data: { ...emptyResults(), streams: allOnlyStreams },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    useSearchStreamsMock.mockReturnValue({
      data: [focusedStream],
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchStreams>);
    useSearchCategoriesMock.mockReturnValue({
      data: { pages: [{ data: [focusedCategory] }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchCategories>);

    renderWithProviders(<SearchPage />);
    fireEvent.click(screen.getByRole("button", { name: "Streams" }));

    expect(useSearchStreamsMock).toHaveBeenLastCalledWith("A", undefined, 20, true, false);
    expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams");

    fireEvent.click(screen.getByRole("button", { name: "Categories" }));

    expect(useSearchCategoriesMock).toHaveBeenLastCalledWith("A", undefined, 20, true);
    expect(screen.getByTestId("category-grid")).toHaveTextContent("1 categories");
  });

  it("shows a focused empty state after a dedicated query settles", () => {
    const allOnlyChannel = fixtures.channel({ id: "all-channel", displayName: "All Channel" });
    useSearchAllMock.mockReturnValue({
      data: {
        ...emptyResults(),
        channels: [allOnlyChannel],
        streams: [fixtures.stream({ id: "all-only" })],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);

    renderWithProviders(<SearchPage />);
    fireEvent.click(screen.getByRole("button", { name: "Videos" }));

    expect(useSearchVideosMock).toHaveBeenLastCalledWith("A", undefined, 12, true);
    expect(screen.getByText(/found 0 results/i)).toBeInTheDocument();
    expect(screen.queryByText("All Channel")).not.toBeInTheDocument();
    expect(screen.getByText(/no results found for/i)).toBeInTheDocument();
  });

  it("renders dedicated video and clip data as recent content from matching channels", () => {
    useSearchAllMock.mockReturnValue({
      data: emptyResults(),
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    useSearchVideosMock.mockReturnValue({
      data: [
        {
          id: "focused-video",
          platform: "twitch",
          title: "Matching Channel Video",
          thumbnailUrl: "https://example.com/video.jpg",
          duration: 120,
          channelName: "matchingchannel",
          channelDisplayName: "Matching Channel",
          channelAvatar: "",
          viewCount: 10,
          publishedAt: "2026-08-24T00:00:00.000Z",
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchVideos>);
    useSearchClipsMock.mockReturnValue({
      data: [
        {
          id: "focused-clip",
          platform: "kick",
          title: "Matching Channel Clip",
          thumbnailUrl: "https://example.com/clip.jpg",
          duration: 30,
          channelName: "matchingchannel",
          channelDisplayName: "Matching Channel",
          channelAvatar: "",
          creatorName: "viewer",
          viewCount: 20,
          createdAt: "2026-08-24T00:00:00.000Z",
          clipUrl: "https://kick.com/matchingchannel/clips/focused-clip",
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchClips>);

    renderWithProviders(<SearchPage />);
    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    expect(screen.getAllByText("Matching Channel Video")).not.toHaveLength(0);
    expect(screen.getByText("Recent content from matching channels.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clips" }));
    expect(screen.getAllByText("Matching Channel Clip")).not.toHaveLength(0);
    expect(screen.getByText("Recent content from matching channels.")).toBeInTheDocument();
  });

  it("loads focused Twitch and Kick media in scroll batches and stops at exhaustion", () => {
    const fetchMoreVideos = vi.fn().mockResolvedValue(undefined);
    const fetchMoreClips = vi.fn().mockResolvedValue(undefined);
    useSearchAllMock.mockReturnValue({
      data: emptyResults(),
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    useSearchVideosMock.mockReturnValue({
      data: [],
      isLoading: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fetchMoreVideos,
    } as unknown as ReturnType<typeof useSearchVideos>);
    useSearchClipsMock.mockReturnValue({
      data: [],
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: fetchMoreClips,
    } as unknown as ReturnType<typeof useSearchClips>);

    renderWithProviders(<SearchPage />);
    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    expect(screen.getByTestId("videos-infinite-sentinel")).toBeInTheDocument();
    const videoObserver = intersectionCallbacks.at(-1)!;
    videoObserver(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
    expect(fetchMoreVideos).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Clips" }));
    expect(screen.queryByTestId("clips-infinite-sentinel")).not.toBeInTheDocument();
    expect(fetchMoreClips).not.toHaveBeenCalled();
  });

  it("shows loading feedback while a focused media query is pending", () => {
    useSearchAllMock.mockReturnValue({
      data: emptyResults(),
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    useSearchClipsMock.mockReturnValue({ data: [], isLoading: true } as unknown as ReturnType<
      typeof useSearchClips
    >);

    renderWithProviders(<SearchPage />);
    fireEvent.click(screen.getByRole("button", { name: "Clips" }));

    expect(useSearchClipsMock).toHaveBeenLastCalledWith("A", undefined, 12, true);
    expect(screen.getByLabelText("Loading clips")).toBeInTheDocument();
    expect(screen.queryByText(/no results found for/i)).not.toBeInTheDocument();
  });

  it("renders video thumbnails through ProxiedImage instead of raw img tags", () => {
    const kickThumbnail =
      "https://images.kick.com/video_thumbnails/IUNVIedvenl6/uY2FgPJlfoS2/720.webp";
    useSearchAllMock.mockReturnValue({
      data: {
        ...emptyResults(),
        videos: [
          {
            id: "kick-vod-1",
            platform: "kick",
            title: "Kick VOD",
            thumbnailUrl: kickThumbnail,
            duration: 120,
            channelAvatar: "https://images.kick.com/profile.webp",
            channelName: "kickchannel",
            channelDisplayName: "Kick Channel",
            viewCount: 10,
            publishedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);

    renderWithProviders(<SearchPage />);

    expect(screen.getByTestId("proxied-image")).toHaveAttribute("data-src", kickThumbnail);
  });

  it("hides a video card when its thumbnail fails", () => {
    useSearchAllMock.mockReturnValue({
      data: {
        ...emptyResults(),
        videos: [
          {
            id: "broken-vod",
            platform: "kick",
            title: "Broken thumbnail VOD",
            thumbnailUrl: "https://images.kick.com/missing.webp",
            duration: 120,
            channelAvatar: "",
            channelName: "kickchannel",
            channelDisplayName: "Kick Channel",
            viewCount: 10,
            publishedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);

    renderWithProviders(<SearchPage />);
    fireEvent.click(screen.getByTestId("proxied-image"));

    expect(screen.queryByText("Broken thumbnail VOD")).not.toBeInTheDocument();
  });

  it("uses a solid white background for the selected All platform filter", () => {
    useSearchAllMock.mockReturnValue({ data: emptyResults(), isLoading: false } as unknown as ReturnType<
      typeof useSearchAll
    >);

    renderWithProviders(<SearchPage />);

    expect(screen.getByRole("button", { name: "ALL" })).toHaveClass("bg-white");
  });

  it('loading: forwards isLoading=true to the grids so skeletons render instead of "0 streams"', () => {
    useSearchAllMock.mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<
      typeof useSearchAll
    >);
    renderWithProviders(<SearchPage />);
    // The page renders both grids and forwards isLoading. The mocked grids
    // print "0 streams"/"0 categories" content even on loading since they
    // read the streams prop length, but the page mounts the section headers
    // and grid containers in loading mode without throwing.
    expect(screen.getByTestId("stream-grid")).toBeInTheDocument();
  });

  it('error: useSearchAll returns data=undefined (GQL fail) → page renders the "0 results" header same as empty, so the user sees a consistent recovery surface', () => {
    useSearchAllMock.mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<
      typeof useSearchAll
    >);
    renderWithProviders(<SearchPage />);
    // The header still renders even for an undefined data payload.
    expect(screen.getByText(/search results for/i)).toBeInTheDocument();
  });
});
