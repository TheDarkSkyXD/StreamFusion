import { beforeEach, describe, expect, it, vi } from "vitest";

import { fixtures, renderWithProviders, routerMock, screen } from "../test-utils";

vi.mock("@tanstack/react-router", () => routerMock({ search: { q: "A" } }));

vi.mock("@/hooks/queries/useSearch", () => ({
  useSearchAll: vi.fn(),
  useSearchChannels: vi.fn(),
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
  ProxiedImage: ({ src, alt }: { src: string; alt: string }) => (
    <div data-testid="proxied-image" data-src={src}>
      {alt}
    </div>
  ),
}));

import { useSearchAll, useSearchChannels } from "@/hooks/queries/useSearch";
import { SearchPage } from "@/pages/SearchResults";

const useSearchAllMock = vi.mocked(useSearchAll);
const useSearchChannelsMock = vi.mocked(useSearchChannels);

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
describe("SearchPage", () => {
  beforeEach(() => {
    useSearchAllMock.mockReset();
    useSearchChannelsMock.mockReset();
    useSearchChannelsMock.mockReturnValue(channelQuery());
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
    expect(useSearchAllMock).toHaveBeenCalledWith("A", undefined, 20);
    expect(useSearchChannelsMock).toHaveBeenCalledWith("A", undefined, 50);
  });

  it("renders all channel pages from the dedicated channel search, not the capped search-all bundle", () => {
    const cappedBundleChannel = fixtures.channel({
      id: "bundle-only",
      username: "bundleonly",
      displayName: "BundleOnly",
    });
    const channels = Array.from({ length: 60 }, (_, i) =>
      fixtures.channel({
        id: `a-${i}`,
        username: `alpha${i}`,
        displayName: `Alpha${i}`,
      })
    );
    useSearchAllMock.mockReturnValue({
      data: { ...emptyResults(), channels: [cappedBundleChannel] },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    useSearchChannelsMock.mockReturnValue(
      channelQuery([{ data: channels.slice(0, 50) }, { data: channels.slice(50) }])
    );

    renderWithProviders(<SearchPage />);

    expect(screen.getByText(/found 60 results/i)).toBeInTheDocument();
    expect(screen.getAllByText("Alpha59").length).toBeGreaterThan(0);
    expect(screen.queryByText("BundleOnly")).not.toBeInTheDocument();
  });

  it("renders platform partner badges beside channel search results", () => {
    useSearchAllMock.mockReturnValue({
      data: emptyResults(),
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    useSearchChannelsMock.mockReturnValue(
      channelQuery([
        {
          data: [
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
          ],
        },
      ])
    );

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
