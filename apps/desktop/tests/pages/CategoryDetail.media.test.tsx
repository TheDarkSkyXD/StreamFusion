import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "@/shared/auth-types";
import type { CategoryMediaItem } from "@/shared/category-media-types";

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  userEvent,
} from "../test-utils";

const routeState = vi.hoisted(() => ({ platform: "twitch", categoryId: "509658" }));
const searchState = vi.hoisted(() => ({
  tab: "clips" as "clips" | "videos",
  platform: "all" as "all" | "twitch" | "kick",
  language: "",
  tag: "",
  sort: "desc" as "desc" | "asc",
  otherId: "15" as string | undefined,
}));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  ...routerMock({ params: routeState, search: searchState }),
  useLocation: () => ({
    pathname: `/categories/${routeState.platform}/${routeState.categoryId}`,
    search: searchState,
  }),
  useNavigate: () => navigateMock,
}));

vi.mock("@/hooks/queries/useCategories", () => ({
  useCategoryById: vi.fn(),
  useTopCategories: vi.fn(),
}));

vi.mock("@/hooks/queries/useInfiniteStreams", () => ({
  useInfiniteStreamsByCategory: vi.fn(),
}));

vi.mock("@/components/stream/stream-grid", () => ({
  StreamGrid: () => <div data-testid="live-stream-grid">Live streams</div>,
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock("@/components/ui/platform-avatar", () => ({
  PlatformAvatar: ({
    alt,
    platform,
    src,
  }: {
    alt: string;
    platform: string;
    src?: string | null;
  }) => (
    <span data-platform={platform} data-avatar-src={src}>
      {alt}
    </span>
  ),
}));

import { useCategoryById, useTopCategories } from "@/hooks/queries/useCategories";
import { useInfiniteStreamsByCategory } from "@/hooks/queries/useInfiniteStreams";
import { CategoryDetailPage } from "@/pages/CategoryDetail";

const useCategoryByIdMock = vi.mocked(useCategoryById);
const useTopCategoriesMock = vi.mocked(useTopCategories);
const useInfiniteStreamsByCategoryMock = vi.mocked(useInfiniteStreamsByCategory);

function categoryMediaItem(
  platform: Platform,
  overrides: Partial<CategoryMediaItem> = {}
): CategoryMediaItem {
  const createdAt = "2026-07-15T12:00:00.000Z";
  return {
    id: `${platform}-media`, title: `${platform} media`, duration: "0:30", views: "1",
    date: createdAt, created_at: createdAt, thumbnailUrl: `https://example.com/${platform}.jpg`,
    platform, channelId: `${platform}-channel`, channelName: `${platform} channel`,
    channelAvatar: `https://example.com/${platform}-avatar.jpg`,
    gameId: platform === "twitch" ? "509658" : "15", gameName: "Just Chatting",
    category: "Just Chatting", ...overrides,
  };
}

function emptyInfiniteStreams() {
  return {
    data: { pages: [] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>;
}

function installCategoryFixtures() {
  useCategoryByIdMock.mockImplementation(
    (id, platform) =>
      ({
        data: fixtures.category({
          id,
          platform,
          name: "Just Chatting",
          slug: "just-chatting",
          crossPlatformId: platform === "twitch" ? "15" : "509658",
        }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }) as unknown as ReturnType<typeof useCategoryById>
  );
  useTopCategoriesMock.mockReturnValue({
    data: [
      fixtures.category({
        id: "509658",
        platform: "twitch",
        name: "Just Chatting",
        viewerCount: 100_000,
        crossPlatformId: "15",
      }),
    ],
    isLoading: false,
  } as unknown as ReturnType<typeof useTopCategories>);
  useInfiniteStreamsByCategoryMock.mockReturnValue(emptyInfiniteStreams());
}

// Guards: a deep-linked Clips tab lazily requests both native Category feeds, hides Live Streams, and renders mixed-Platform Clip cards with accumulated View Counts
// Guards: a deep-linked Videos tab lazily requests both native Category feeds, hides Live Streams, and routes each Video card using the item's Platform while showing accumulated View Counts
// Guards: Category media tabs keep the shared Language, Tag, and View-sort filters visible and forward their values to both Platform requests
// Guards: Kick media still loads from category slug/name when a cross-Platform otherId cannot be resolved
// Guards: Category cards preserve numeric game IDs and non-empty channel avatars from the backend payload
// Guards: Clips expose the persisted day/week/month/all time-range filter, while Videos do not
// Guards: the Clips time-range, Language, Tag, and View-sort controls share one Category filters row
// Guards: changing each Clips filter updates URL/persisted state and re-keys the Category media requests
describe("CategoryDetailPage media tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    routeState.platform = "twitch";
    routeState.categoryId = "509658";
    // Category media remains Views-ranked even when the Channel tabs last used Recent.
    localStorage.setItem("content-sort-preference", "recent");
    localStorage.setItem("clips-filter-preference", "all");
    searchState.platform = "all";
    searchState.language = "";
    searchState.tag = "";
    searchState.sort = "desc";
    searchState.otherId = "15";
    navigateMock.mockResolvedValue(undefined);
    installCategoryFixtures();
  });

  it("keeps Clips active and renders real mixed-Platform Clip cards instead of the Live grid", async () => {
    searchState.tab = "clips";
    const api = installElectronAPIMock();
    api.clips.getByCategory = vi.fn<typeof api.clips.getByCategory>(async ({ platform }) => ({
      success: true,
      availability: "available",
      data:
        platform === "twitch"
          ? [
              categoryMediaItem("twitch", { id: "twitch-offline-clip", channelName: "Offline Twitch",
                title: "Twitch Category Highlight", duration: "0:42", views: "1250",
                embedUrl: "https://clips.twitch.tv/embed?clip=twitch-offline-clip", creatorName: "Clipper One" }),
            ]
          : [
              categoryMediaItem("kick", { id: "kick-offline-clip", channelName: "Offline Kick",
                title: "Kick Category Highlight", duration: "0:31", views: "900",
                embedUrl: "https://example.com/kick-clip.mp4", creatorName: "Clipper Two" }),
            ],
      cursor: undefined,
    }));
    api.videos.getByCategory = vi.fn();

    const { rerender } = renderWithProviders(<CategoryDetailPage />);

    await waitFor(() => expect(api.clips.getByCategory).toHaveBeenCalledTimes(2), {
      timeout: 250,
    });
    expect(api.clips.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "twitch",
        categoryId: "509658",
        sort: "views",
        timeRange: "all",
      })
    );
    expect(api.clips.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        categoryId: "15",
        categorySlug: "just-chatting",
        categoryName: "Just Chatting",
        sort: "views",
        timeRange: "all",
      })
    );
    expect(api.videos.getByCategory).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Clips" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("live-stream-grid")).not.toBeInTheDocument();
    expect(screen.getByText("Twitch Category Highlight")).toBeInTheDocument();
    expect(screen.getByText("Kick Category Highlight")).toBeInTheDocument();
    expect(screen.getByText("1.3K views")).toBeInTheDocument();
    expect(screen.getByText("900 views")).toBeInTheDocument();
    expect(screen.getByText("Offline Kick")).toHaveAttribute(
      "data-avatar-src",
      "https://example.com/kick-avatar.jpg"
    );
    expect(
      screen
        .getAllByRole("link", { name: "Just Chatting" })
        .some(
          (link) =>
            link.getAttribute("data-params") ===
            JSON.stringify({ platform: "kick", categoryId: "15" })
        )
    ).toBe(true);

    searchState.platform = "kick";
    rerender(<CategoryDetailPage />);

    await waitFor(() => {
      expect(screen.queryByText("Twitch Category Highlight")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Kick Category Highlight")).toBeInTheDocument();
  });

  it("keeps Videos active and renders item-routed Video cards instead of the Live grid", async () => {
    searchState.tab = "videos";
    const api = installElectronAPIMock();
    api.clips.getByCategory = vi.fn();
    api.videos.getByCategory = vi.fn<typeof api.videos.getByCategory>(async ({ platform }) => ({
      success: true,
      availability: "available",
      data:
        platform === "twitch"
          ? [
              categoryMediaItem("twitch", {
                id: "twitch-category-video",
                channelId: "twitch-video-channel",
                channelName: "Twitch Archive",
                channelAvatar: "https://example.com/twitch-video-avatar.jpg",
                title: "Twitch Category VOD",
                thumbnailUrl: "https://example.com/twitch-video.jpg",
                duration: "1:00:00",
                views: "2500",
                url: "https://twitch.tv/videos/twitch-category-video",
                gameId: "509658",
                gameName: "Just Chatting",
              }),
            ]
          : [
              categoryMediaItem("kick", {
                id: "kick-category-video",
                channelId: "kick-video-channel",
                channelName: "Kick Archive",
                channelAvatar: "https://example.com/kick-video-avatar.jpg",
                title: "Kick Offline VOD",
                thumbnailUrl: "https://example.com/kick-video.jpg",
                duration: "0:45:00",
                views: "1100",
                url: "https://kick.com/kick_archive/videos/kick-category-video",
                gameId: "15",
                gameName: "Just Chatting",
              }),
            ],
      cursor: undefined,
    }));

    renderWithProviders(<CategoryDetailPage />);

    await waitFor(() => expect(api.videos.getByCategory).toHaveBeenCalledTimes(2), {
      timeout: 250,
    });
    expect(api.videos.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "twitch", categoryId: "509658", sort: "views" })
    );
    expect(api.videos.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "kick", categoryId: "15", sort: "views" })
    );
    expect(api.clips.getByCategory).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Videos" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("live-stream-grid")).not.toBeInTheDocument();
    expect(screen.getByText("Twitch Category VOD")).toBeInTheDocument();
    const kickVideoTitle = screen.getByText("Kick Offline VOD");
    expect(kickVideoTitle).toBeInTheDocument();
    expect(screen.getByText("2.5K views")).toBeInTheDocument();
    expect(screen.getByText("1.1K views")).toBeInTheDocument();
    expect(kickVideoTitle.closest("a")).toHaveAttribute("data-to", "/video/$platform/$videoId");
    expect(kickVideoTitle.closest("a")).toHaveAttribute(
      "data-params",
      JSON.stringify({ platform: "kick", videoId: "kick-category-video" })
    );
    expect(screen.getByText("Kick Archive")).toHaveAttribute(
      "data-avatar-src",
      "https://example.com/kick-video-avatar.jpg"
    );
    expect(
      screen
        .getAllByRole("link", { name: "Just Chatting" })
        .some(
          (link) =>
            link.getAttribute("data-params") ===
            JSON.stringify({ platform: "kick", categoryId: "15" })
        )
    ).toBe(true);
    expect(screen.queryByText("Filter by:")).not.toBeInTheDocument();
  });

  it("applies shared category filters while keeping Clips Views sort most-viewed-first", async () => {
    searchState.tab = "clips";
    searchState.language = "en";
    searchState.tag = "speedrun";
    searchState.sort = "asc";
    const api = installElectronAPIMock();
    api.clips.getByCategory = vi.fn<typeof api.clips.getByCategory>(async ({ platform }) => ({
      success: true,
      availability: "available",
      data: [
        categoryMediaItem(platform, {
          id: `${platform}-filtered-clip`,
          channelId: `${platform}-channel`,
          channelName: `${platform} Runner`,
          channelAvatar: `https://example.com/${platform}-avatar.jpg`,
          title: platform === "twitch" ? "Higher View Clip" : "Lower View Clip",
          thumbnailUrl: `https://example.com/${platform}-clip.jpg`,
          embedUrl: `https://example.com/${platform}-filtered-clip.mp4`,
          duration: "0:30",
          views: platform === "twitch" ? "500" : "100",
          creatorName: `${platform} clipper`,
          gameId: platform === "twitch" ? "509658" : "15",
          gameName: "Just Chatting",
        }),
      ],
      cursor: undefined,
    }));

    renderWithProviders(<CategoryDetailPage />);

    expect(screen.getByLabelText("Language")).toHaveTextContent("English");
    expect(screen.getByLabelText("Tag")).toHaveValue("speedrun");
    expect(screen.getByLabelText("Sort Category clips")).toHaveTextContent("Views");
    await waitFor(() => expect(api.clips.getByCategory).toHaveBeenCalledTimes(2));
    expect(api.clips.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "twitch",
        language: "en",
        tag: "speedrun",
        sort: "views",
        direction: "desc",
      })
    );
    expect(api.clips.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        language: "en",
        tag: "speedrun",
        sort: "views",
        direction: "desc",
      })
    );

    const higherViewClip = screen.getByText("Higher View Clip");
    const lowerViewClip = screen.getByText("Lower View Clip");
    expect(higherViewClip.compareDocumentPosition(lowerViewClip)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.queryByLabelText("View order")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date order")).not.toBeInTheDocument();
  });

  it("requests Kick Clips by slug and name when the secondary category ID is missing", async () => {
    searchState.tab = "clips";
    searchState.otherId = undefined;
    const api = installElectronAPIMock();
    api.categories.search = vi.fn<typeof api.categories.search>(async () => ({
      success: true,
      data: [],
      providers: { kick: "complete" },
    }));
    api.clips.getByCategory = vi.fn<typeof api.clips.getByCategory>(async () => ({
      success: true,
      availability: "available",
      data: [],
    }));

    renderWithProviders(<CategoryDetailPage />);

    await waitFor(() => expect(api.clips.getByCategory).toHaveBeenCalledTimes(2));
    expect(api.clips.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        categoryId: "",
        categorySlug: "just-chatting",
        categoryName: "Just Chatting",
      })
    );
    expect(screen.queryByText("Kick clips are temporarily unavailable.")).not.toBeInTheDocument();
  });

  it("restores and reactively persists the Clips time-range filter", async () => {
    searchState.tab = "clips";
    localStorage.setItem("clips-filter-preference", "week");
    const api = installElectronAPIMock();
    api.clips.getByCategory = vi.fn<typeof api.clips.getByCategory>(async () => ({
      success: true,
      availability: "available",
      data: [],
    }));
    const user = userEvent.setup();

    renderWithProviders(<CategoryDetailPage />);

    await waitFor(() => expect(api.clips.getByCategory).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Filter by:")).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(screen.getByLabelText("Filter clips by time range")).toHaveTextContent("Last Week");
    const filterRow = screen.getByRole("group", { name: "Category filters" });
    const textFilters = screen.getByRole("group", { name: "Category text filters" });
    const clipFilters = screen.getByRole("group", { name: "Category clip filters" });
    expect(filterRow).toContainElement(textFilters);
    expect(filterRow).toContainElement(clipFilters);
    expect(textFilters).toContainElement(screen.getByLabelText("Language"));
    expect(textFilters).toContainElement(screen.getByLabelText("Tag"));
    expect(clipFilters).toContainElement(screen.getByLabelText("Filter clips by time range"));
    expect(clipFilters).toContainElement(screen.getByLabelText("Sort Category clips"));
    expect(clipFilters).toHaveClass("sm:ml-auto", "sm:justify-end");
    expect(screen.queryByLabelText("View order")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date order")).not.toBeInTheDocument();
    expect(api.clips.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({ timeRange: "week" })
    );

    await user.click(screen.getByLabelText("Filter clips by time range"));
    await user.click(screen.getByRole("option", { name: "Last Month" }));

    await waitFor(() => {
      expect(api.clips.getByCategory).toHaveBeenCalledWith(
        expect.objectContaining({ timeRange: "month" })
      );
    });
    expect(localStorage.getItem("clips-filter-preference")).toBe("month");
  });

  it("keeps Kick-only Category Clips and Videos usable without a Twitch mapping", async () => {
    routeState.platform = "kick";
    routeState.categoryId = "15";
    searchState.tab = "clips";
    searchState.platform = "twitch";
    searchState.language = "en";
    searchState.tag = "speedrun";
    searchState.sort = "asc";
    searchState.otherId = undefined;
    localStorage.setItem("clips-filter-preference", "day");
    const api = installElectronAPIMock();
    api.categories.search = vi.fn<typeof api.categories.search>(async () => ({
      success: true,
      data: [],
      providers: { kick: "complete" },
    }));
    api.clips.getByCategory = vi.fn<typeof api.clips.getByCategory>(async () => ({
      success: true,
      availability: "available",
      data: [
        categoryMediaItem("kick", {
          id: "kick-only-clip",
          channelId: "kick-only-channel",
          channelName: "Kick Only",
          channelAvatar: "https://example.com/kick-only-avatar.jpg",
          title: "Kick-only Category Clip",
          thumbnailUrl: "https://example.com/kick-only-clip.jpg",
          url: "https://kick.com/kick_only?clip=kick-only-clip",
          duration: "0:20",
          views: "40",
          gameId: "15",
          gameName: "Just Chatting",
        }),
      ],
    }));
    api.videos.getByCategory = vi.fn<typeof api.videos.getByCategory>(async () => ({
      success: true,
      availability: "available",
      data: [
        categoryMediaItem("kick", {
          id: "kick-only-video",
          channelId: "kick-only-channel",
          channelName: "Kick Only",
          channelAvatar: "https://example.com/kick-only-avatar.jpg",
          title: "Kick-only Category Video",
          thumbnailUrl: "https://example.com/kick-only-video.jpg",
          duration: "0:20:00",
          views: "80",
          url: "https://kick.com/kick_only/videos/kick-only-video",
          gameId: "15",
          gameName: "Just Chatting",
        }),
      ],
    }));

    const { rerender } = renderWithProviders(<CategoryDetailPage />);

    await waitFor(() => expect(api.clips.getByCategory).toHaveBeenCalledTimes(1));
    expect(api.clips.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        categoryId: "15",
        language: "en",
        tag: "speedrun",
        direction: "desc",
        timeRange: "day",
      })
    );
    expect(screen.getByText("Kick-only Category Clip")).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toHaveTextContent("English");
    expect(screen.getByLabelText("Tag")).toHaveValue("speedrun");
    expect(screen.getByLabelText("Filter clips by time range")).toHaveTextContent("Last Day");
    expect(screen.queryByLabelText("View order")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date order")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Platform" })).not.toBeInTheDocument();

    searchState.tab = "videos";
    rerender(<CategoryDetailPage />);

    await waitFor(() => expect(api.videos.getByCategory).toHaveBeenCalledTimes(1));
    expect(api.videos.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        categoryId: "15",
        language: "en",
        tag: "speedrun",
        direction: "asc",
      })
    );
    expect(screen.getByText("Kick-only Category Video")).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter clips by time range")).not.toBeInTheDocument();
  });

  it("re-requests Category Clips as each filter control changes", async () => {
    searchState.tab = "clips";
    const api = installElectronAPIMock();
    api.clips.getByCategory = vi.fn<typeof api.clips.getByCategory>(async ({ platform }) => ({
      success: true,
      availability: "available",
      data: [
        {
          id: `${platform}-filter-clip`,
          title: platform === "twitch" ? "Older Popular Clip" : "Newer Quiet Clip",
          duration: "00:30",
          views: platform === "twitch" ? "500" : "100",
          date: platform === "twitch" ? "2026-07-10T12:00:00.000Z" : "2026-07-16T12:00:00.000Z",
          created_at:
            platform === "twitch" ? "2026-07-10T12:00:00.000Z" : "2026-07-16T12:00:00.000Z",
          thumbnailUrl: `https://example.com/${platform}-filter-clip.jpg`,
          platform,
          channelId: `${platform}-filter-channel`,
          channelName: `${platform}_filter_channel`,
          channelAvatar: `https://example.com/${platform}-filter-avatar.jpg`,
          gameId: platform === "twitch" ? "509658" : "15",
          gameName: "Just Chatting",
          category: "Just Chatting",
        },
      ],
    }));
    navigateMock.mockImplementation(
      async ({ search }: { search?: Partial<typeof searchState> }) => {
        if (search) Object.assign(searchState, search);
      }
    );
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<CategoryDetailPage />);

    await waitFor(() => expect(api.clips.getByCategory).toHaveBeenCalledTimes(2));
    expect(api.clips.getByCategory).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "views", direction: "desc" })
    );
    expect(
      screen
        .getByText("Older Popular Clip")
        .compareDocumentPosition(screen.getByText("Newer Quiet Clip"))
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await user.click(screen.getByLabelText("Language"));
    await user.click(screen.getByRole("option", { name: "English" }));
    rerender(<CategoryDetailPage />);
    await waitFor(() => {
      expect(api.clips.getByCategory).toHaveBeenCalledWith(
        expect.objectContaining({ language: "en" })
      );
    });

    await user.type(screen.getByLabelText("Tag"), "speedrun");
    rerender(<CategoryDetailPage />);
    await waitFor(() => {
      expect(api.clips.getByCategory).toHaveBeenCalledWith(
        expect.objectContaining({ language: "en", tag: "speedrun" })
      );
    });

    await user.click(screen.getByLabelText("Sort Category clips"));
    await user.click(screen.getByRole("option", { name: "Most Recent" }));
    await waitFor(() => {
      expect(api.clips.getByCategory).toHaveBeenCalledWith(
        expect.objectContaining({ tag: "speedrun", sort: "date", direction: "desc" })
      );
    });
    expect(
      screen
        .getByText("Newer Quiet Clip")
        .compareDocumentPosition(screen.getByText("Older Popular Clip"))
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(screen.queryByLabelText("Date order")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("View order")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Filter clips by time range"));
    await user.click(screen.getByRole("option", { name: "Last Week" }));
    await waitFor(() => {
      expect(api.clips.getByCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          language: "en",
          tag: "speedrun",
          sort: "date",
          direction: "desc",
          timeRange: "week",
        })
      );
    });

    expect(localStorage.getItem("clips-filter-preference")).toBe("week");
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ language: "en" }) })
    );
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ tag: "speedrun" }) })
    );
  });
});
