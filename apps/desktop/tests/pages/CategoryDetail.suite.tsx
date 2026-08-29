import { act, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fireEvent,
  fixtures,
  installElectronAPIMock,
  renderWithProviders as renderWithBaseProviders,
  routerMock,
  screen,
  waitFor,
} from "../test-utils";

const categoryRouteState = vi.hoisted(() => ({ platform: "twitch", categoryId: "cat-1" }));
const categorySearchState = vi.hoisted(() => ({
  tab: "live" as "live" | "clips" | "videos",
  platform: "all" as "all" | "twitch" | "kick",
  language: "",
  tag: "",
  sort: "desc" as "desc" | "asc",
  otherId: undefined as string | undefined,
}));
const categoryRawSearchState = vi.hoisted(() => ({ tab: undefined as string | undefined }));
const categoryLocationState = vi.hoisted(() => ({
  pathname: "/categories/twitch/cat-1",
}));
const categoryNavigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  ...routerMock({ params: categoryRouteState, search: categorySearchState }),
  useLocation: () => ({
    pathname: categoryLocationState.pathname,
    search: categoryRawSearchState,
  }),
  useNavigate: () => categoryNavigateMock,
}));

vi.mock("@/features/discovery/data/queries/useCategories", () => ({
  useCategoryById: vi.fn(),
  useInfiniteTopCategories: vi.fn(),
}));

vi.mock("@/features/discovery/data/queries/useInfiniteStreams", () => ({
  useInfiniteStreamsByCategory: vi.fn(),
}));

// A cached category must not depend on this post-paint gate. Keeping the mock
// false makes the regression fail if the gate is reintroduced.
vi.mock("@/hooks/useAfterFirstPaint", () => ({
  useAfterFirstPaint: () => false,
}));

vi.mock("@/features/discovery/components/stream/stream-grid", () => ({
  StreamGrid: ({
    streams,
    isLoading,
    emptyMessage,
    datasetKey,
  }: {
    streams: Array<{ id: string }>;
    isLoading?: boolean;
    emptyMessage?: string;
    datasetKey: string;
  }) => (
    <div data-testid="stream-grid" data-dataset-key={datasetKey}>
      {isLoading
        ? "loading"
        : streams.length === 0
          ? emptyMessage
          : `${streams.length} streams:${streams.map((stream) => stream.id).join(",")}`}
    </div>
  ),
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div data-testid="proxied-image">{alt}</div>,
}));

import {
  useCategoryById,
  useInfiniteTopCategories,
} from "@/features/discovery/data/queries/useCategories";
import { useInfiniteStreamsByCategory } from "@/features/discovery/data/queries/useInfiniteStreams";
import { CategoryDetailPage } from "@/pages/CategoryDetail";

const useCategoryByIdMock = vi.mocked(useCategoryById);
const useInfiniteTopCategoriesMock = vi.mocked(useInfiniteTopCategories);
const useInfiniteStreamsByCategoryMock = vi.mocked(useInfiniteStreamsByCategory);
let categoryDetailQueryClient: QueryClient;

function renderWithProviders(
  ui: Parameters<typeof renderWithBaseProviders>[0],
  options?: Parameters<typeof renderWithBaseProviders>[1]
) {
  return renderWithBaseProviders(ui, { ...options, queryClient: categoryDetailQueryClient });
}

function emptyInfinite() {
  return {
    data: { pages: [] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>;
}

// Guards: loading state — category metadata may skeleton independently, but navigation and already-loaded streams remain usable
// Guards: error state — useCategoryById returns data=undefined → category name "Unknown Category" surfaces; the streams grid still mounts so users can see live streams while the category metadata recovers
// Guards: empty state — useInfiniteStreamsByCategory returns pages=[] for both primary + secondary → streams grid shows 0 streams; distinct from loading via the absent .animate-pulse
// Guards: cached category metadata and streams render in the initial commit without waiting for an unrelated post-paint gate
// Guards: category header uses the merged Twitch + Kick total instead of a platform-only total or partial loaded-stream sum
// Guards: URL-backed tabs and Live filters preserve Category identity and reproduce copied or history-restored views
// Guards: Category content tabs remain visibly sticky with the primary active and keyboard-focus treatment
// Guards: late stale-otherId repair cannot redirect after the Category route becomes inactive
// Guards: Platform scope keeps loading, filtering, pagination, failure retry, and empty states independent
// Guards: Live Viewer Count updates immediately restore the selected exact ordering
function registerCategoryDetailTests(name: string, registerTests: () => void) {
  describe(`CategoryDetailPage ${name}`, () => {
    beforeEach(() => {
      categoryDetailQueryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
          mutations: { retry: false },
        },
      });
      categoryRouteState.platform = "twitch";
      categoryRouteState.categoryId = "cat-1";
      categorySearchState.tab = "live";
      categorySearchState.platform = "all";
      categorySearchState.language = "";
      categorySearchState.tag = "";
      categorySearchState.sort = "desc";
      categorySearchState.otherId = undefined;
      categoryLocationState.pathname = "/categories/twitch/cat-1";
      categoryRawSearchState.tab = undefined;
      categoryNavigateMock.mockReset();
      installElectronAPIMock();
      useCategoryByIdMock.mockReset();
      useInfiniteTopCategoriesMock.mockReset();
      useInfiniteTopCategoriesMock.mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useInfiniteTopCategories>);
      useInfiniteStreamsByCategoryMock.mockReset();
      useInfiniteStreamsByCategoryMock.mockReturnValue(emptyInfinite());
    });

    afterEach(async () => {
      await categoryDetailQueryClient.cancelQueries();
      vi.unstubAllGlobals();
    });

    registerTests();
  });
}

export function registerNavigationGuardTests() {
  registerCategoryDetailTests("navigation guards", () => {
    it("does not repair stale Category identity after navigation has entered a Stream", async () => {
      categoryRouteState.platform = "twitch";
      categoryRouteState.categoryId = "509658";
      categorySearchState.otherId = "stale-kick-id";
      categoryLocationState.pathname = "/stream/twitch/ninja";
      categoryRawSearchState.tab = "home";
      const api = installElectronAPIMock();
      api.categories.search = vi.fn<typeof api.categories.search>(async () => ({
        success: true,
        data: [
          fixtures.category({
            id: "15",
            platform: "kick",
            name: "Just Chatting",
          }),
        ],
        providers: { kick: "complete" },
      }));
      useCategoryByIdMock.mockImplementation(
        (id, queryPlatform) =>
          ({
            data:
              queryPlatform === "twitch"
                ? fixtures.category({ id: "509658", platform: "twitch", name: "Just Chatting" })
                : fixtures.category({ id, platform: "kick", name: "Fortnite" }),
            isLoading: false,
          }) as ReturnType<typeof useCategoryById>
      );

      renderWithProviders(<CategoryDetailPage />);

      await waitFor(() =>
        expect(screen.getByRole("link", { name: "Clips" })).toHaveAttribute(
          "data-search",
          expect.stringContaining('"otherId":"15"')
        )
      );
      expect(categoryNavigateMock).not.toHaveBeenCalled();
    });
  });
}

export function registerIdentityTests() {
  registerCategoryDetailTests("identity and header", () => {
    it("loading: renders the .animate-pulse header skeleton while category is loading", () => {
      useCategoryByIdMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
        typeof useCategoryById
      >);
      const { container } = renderWithProviders(<CategoryDetailPage />);
      expect(container.querySelector(".animate-pulse")).toHaveClass("motion-reduce:animate-none");
      expect(screen.getByRole("link", { name: /back to categories/i })).toBeInTheDocument();
      expect(screen.getByTestId("stream-grid")).not.toHaveTextContent("loading");
    });

    it("keeps canonical Twitch and Kick identities separate for a merged category route", () => {
      categoryRouteState.platform = "twitch";
      categoryRouteState.categoryId = "509658";
      categorySearchState.otherId = "15";
      useCategoryByIdMock.mockImplementation(
        (id, queryPlatform) =>
          ({
            data: fixtures.category({
              id,
              platform: queryPlatform,
              name: "Just Chatting",
              crossPlatformId: queryPlatform === "twitch" ? "15" : "509658",
            }),
            isLoading: false,
          }) as ReturnType<typeof useCategoryById>
      );

      renderWithProviders(<CategoryDetailPage />);

      expect(useInfiniteStreamsByCategoryMock).toHaveBeenNthCalledWith(
        1,
        "509658",
        "twitch",
        30,
        undefined,
        undefined,
        "all:::desc"
      );
      expect(useInfiniteStreamsByCategoryMock).toHaveBeenNthCalledWith(
        2,
        "15",
        "kick",
        30,
        "Just Chatting",
        undefined,
        "all:::desc"
      );
    });

    it("rejects a stale secondary Category id before unrelated Streams can enter the feed", () => {
      categoryRouteState.platform = "twitch";
      categoryRouteState.categoryId = "509658";
      categorySearchState.otherId = "tampered-kick-id";
      useCategoryByIdMock.mockImplementation(
        (id, queryPlatform) =>
          ({
            data:
              queryPlatform === "twitch"
                ? fixtures.category({
                    id: "509658",
                    platform: "twitch",
                    name: "Just Chatting",
                  })
                : fixtures.category({
                    id,
                    platform: "kick",
                    name: "Fortnite",
                  }),
            isLoading: false,
          }) as ReturnType<typeof useCategoryById>
      );
      useInfiniteStreamsByCategoryMock.mockImplementation((id, queryPlatform, _limit, name) => {
        if (queryPlatform === "twitch") {
          return {
            ...emptyInfinite(),
            data: { pages: [{ data: [fixtures.stream({ id: "primary-live" })] }] },
          } as ReturnType<typeof useInfiniteStreamsByCategory>;
        }
        if (id === "tampered-kick-id") {
          return {
            ...emptyInfinite(),
            data: {
              pages: [
                {
                  data: [fixtures.stream({ id: "unrelated-live", platform: "kick" })],
                },
              ],
            },
          } as ReturnType<typeof useInfiniteStreamsByCategory>;
        }
        if (name === "Just Chatting") {
          return {
            ...emptyInfinite(),
            data: {
              pages: [{ data: [fixtures.stream({ id: "safe-name-match", platform: "kick" })] }],
            },
          } as ReturnType<typeof useInfiniteStreamsByCategory>;
        }
        return emptyInfinite();
      });

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByTestId("stream-grid")).toHaveTextContent(
        "2 streams:primary-live,safe-name-match"
      );
      expect(screen.getByTestId("stream-grid")).not.toHaveTextContent("unrelated-live");
    });

    it("repairs a stale otherId in the URL and native tab links after resolving the correct Category", async () => {
      categoryRouteState.platform = "twitch";
      categoryRouteState.categoryId = "509658";
      categoryLocationState.pathname = "/categories/twitch/509658";
      categorySearchState.otherId = "stale-kick-id";
      const api = installElectronAPIMock();
      api.categories.search = vi.fn<typeof api.categories.search>(async () => ({
        success: true,
        data: [
          fixtures.category({
            id: "15",
            platform: "kick",
            name: "Just Chatting",
          }),
        ],
        providers: { kick: "complete" },
      }));
      useCategoryByIdMock.mockImplementation(
        (id, queryPlatform) =>
          ({
            data:
              queryPlatform === "twitch"
                ? fixtures.category({ id: "509658", platform: "twitch", name: "Just Chatting" })
                : fixtures.category({ id, platform: "kick", name: "Fortnite" }),
            isLoading: false,
          }) as ReturnType<typeof useCategoryById>
      );

      renderWithProviders(<CategoryDetailPage />);

      await waitFor(() =>
        expect(categoryNavigateMock).toHaveBeenCalledWith({
          to: "/categories/$platform/$categoryId",
          params: { platform: "twitch", categoryId: "509658" },
          search: expect.objectContaining({ otherId: "15" }),
          replace: true,
        })
      );
      expect(screen.getByRole("link", { name: "Clips" })).toHaveAttribute(
        "data-search",
        expect.stringContaining('"otherId":"15"')
      );
    });

    it("removes a stale otherId when no matching secondary Category exists", async () => {
      categorySearchState.otherId = "stale-kick-id";
      useCategoryByIdMock.mockImplementation(
        (id, queryPlatform) =>
          ({
            data:
              queryPlatform === "twitch"
                ? fixtures.category({ id: "cat-1", platform: "twitch", name: "Just Chatting" })
                : fixtures.category({ id, platform: "kick", name: "Fortnite" }),
            isLoading: false,
          }) as ReturnType<typeof useCategoryById>
      );

      renderWithProviders(<CategoryDetailPage />);

      await waitFor(() =>
        expect(categoryNavigateMock).toHaveBeenCalledWith({
          to: "/categories/$platform/$categoryId",
          params: { platform: "twitch", categoryId: "cat-1" },
          search: expect.objectContaining({ otherId: undefined }),
          replace: true,
        })
      );
      expect(
        screen.getByRole("link", { name: "Videos" }).getAttribute("data-search")
      ).not.toContain("otherId");
    });

    it("preserves a transient-failure otherId only as a URL hint, never as a Stream query id", async () => {
      categorySearchState.otherId = "15";
      const api = installElectronAPIMock();
      api.categories.search = vi.fn<typeof api.categories.search>(async () => ({
        success: false,
        error: "Temporary category search failure",
        providers: { kick: "failed" },
      }));
      useCategoryByIdMock.mockImplementation((_id, queryPlatform) =>
        queryPlatform === "twitch"
          ? ({
              data: fixtures.category({
                id: "cat-1",
                platform: "twitch",
                name: "Just Chatting",
              }),
              isLoading: false,
              error: null,
            } as ReturnType<typeof useCategoryById>)
          : ({
              data: undefined,
              isLoading: false,
              error: new Error("Temporary provided-id failure"),
            } as ReturnType<typeof useCategoryById>)
      );

      renderWithProviders(<CategoryDetailPage />);

      await waitFor(() => expect(api.categories.search).toHaveBeenCalled());
      expect(useInfiniteStreamsByCategoryMock).toHaveBeenLastCalledWith(
        "",
        "kick",
        30,
        "Just Chatting",
        undefined,
        "all:::desc"
      );
      expect(categoryNavigateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ search: expect.objectContaining({ otherId: undefined }) })
      );
      expect(screen.getByRole("link", { name: "Clips" })).toHaveAttribute(
        "data-search",
        expect.stringContaining('"otherId":"15"')
      );
    });

    it("passes the resolved category name to the primary Kick stream lookup", () => {
      categoryRouteState.platform = "kick";
      categoryRouteState.categoryId = "kick-irl";
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ id: "kick-irl", platform: "kick", name: "IRL" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);

      renderWithProviders(<CategoryDetailPage />);

      expect(useInfiniteStreamsByCategoryMock).toHaveBeenNthCalledWith(
        1,
        "kick-irl",
        "kick",
        30,
        "IRL",
        undefined,
        "all:::desc"
      );
    });

    it("uses the Kick route category as the primary slug while metadata is still pending", () => {
      categoryRouteState.platform = "kick";
      categoryRouteState.categoryId = "IRL";
      useCategoryByIdMock.mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof useCategoryById>);

      renderWithProviders(<CategoryDetailPage />);

      expect(useInfiniteStreamsByCategoryMock).toHaveBeenNthCalledWith(
        1,
        "IRL",
        "kick",
        30,
        "IRL",
        undefined,
        "all:::desc"
      );
    });

    it("renders the category name and box art once loaded", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting", boxArtUrl: "https://x.test/box.jpg" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      renderWithProviders(<CategoryDetailPage />);
      expect(screen.getByRole("heading", { name: "Just Chatting" })).toBeInTheDocument();
      expect(screen.getByTestId("proxied-image")).toHaveTextContent("Just Chatting");
    });

    it("places a labeled native tab navigation after the stable Category header", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);

      renderWithProviders(<CategoryDetailPage />);

      const heading = screen.getByRole("heading", { name: "Just Chatting" });
      const navigation = screen.getByRole("navigation", { name: "Category content" });
      const tabs = screen.getAllByRole("link", { name: /live streams|clips|videos/i });
      expect(heading.compareDocumentPosition(navigation)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(tabs.map((tab) => tab.textContent)).toEqual(["Live Streams", "Clips", "Videos"]);
      expect(tabs[0]).toHaveAttribute("aria-current", "page");
      expect(tabs[1]).not.toHaveAttribute("aria-current");
      expect(tabs[2]).not.toHaveAttribute("aria-current");
      expect(navigation).toHaveClass(
        "sticky",
        "top-0",
        "z-30",
        "bg-[var(--color-background-secondary)]"
      );
      expect(tabs[0]).toHaveClass(
        "border-b-[var(--color-primary)]",
        "text-white",
        "focus-visible:ring-[var(--color-primary)]"
      );
      expect(tabs[1]).toHaveClass("text-[var(--color-foreground-muted)]");
    });

    it.each([
      ["clips", "Clips"],
      ["videos", "Videos"],
    ] as const)("keeps the shipped %s tab active without replacing its URL", (tab, label) => {
      categorySearchState.tab = tab;
      categoryRawSearchState.tab = tab;
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
      expect(categoryNavigateMock).not.toHaveBeenCalled();
    });

    it("shows the authoritative merged category total over platform-only and partial stream totals", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "IRL", viewerCount: 111 }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteTopCategoriesMock.mockReturnValue({
        data: [
          fixtures.category({
            name: "irl",
            viewerCount: 777,
            crossPlatformId: "kick-irl",
          }),
        ],
        isLoading: false,
      } as unknown as ReturnType<typeof useInfiniteTopCategories>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        data: { pages: [{ data: [fixtures.stream({ id: "partial", viewerCount: 33 })] }] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce(emptyInfinite());

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByText("777")).toBeInTheDocument();
      expect(screen.getByText("watching live")).toBeInTheDocument();
      expect(screen.queryByText("111")).not.toBeInTheDocument();
      expect(screen.queryByText("33")).not.toBeInTheDocument();
    });

    it("does not present a one-Platform category aggregate as a combined watching-live total", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "IRL", platform: "twitch", viewerCount: 111 }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteTopCategoriesMock.mockReturnValue({
        data: [fixtures.category({ name: "irl", platform: "twitch", viewerCount: 777 })],
        isLoading: false,
      } as unknown as ReturnType<typeof useInfiniteTopCategories>);

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByText("111")).toBeInTheDocument();
      expect(screen.getByText("watching live on Twitch")).toBeInTheDocument();
      expect(screen.queryByText("777")).not.toBeInTheDocument();
      expect(screen.queryByText("watching live")).not.toBeInTheDocument();
    });

    it("renders cached metadata and streams before any post-paint gate", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting", boxArtUrl: "https://x.test/box.jpg" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        data: { pages: [{ data: [fixtures.stream({ id: "cached-stream" })] }] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce(emptyInfinite());

      const { container } = renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByRole("heading", { name: "Just Chatting" })).toBeInTheDocument();
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams");
      expect(container.querySelector(".animate-pulse")).toBeNull();
    });

    it("keeps the streams loading state tied to the actual primary query", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        isLoading: true,
      } as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce(emptyInfinite());

      const { container } = renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByTestId("stream-grid")).toHaveTextContent("loading");
      expect(container.querySelector(".animate-pulse")).toBeNull();
    });

    it("renders merged streams across primary + secondary platforms", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "GTA V" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        data: { pages: [{ data: [fixtures.stream({ id: "a", viewerCount: 10 })] }] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        data: { pages: [{ data: [fixtures.stream({ id: "b", viewerCount: 20 })] }] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
      renderWithProviders(<CategoryDetailPage />);
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("2 streams");
    });
  });
}

export function registerStateTests() {
  registerCategoryDetailTests("URL and filter state", () => {
    it("filters the Live grid with a text-labeled three-way Platform control", () => {
      categorySearchState.platform = "kick";
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "GTA V" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        data: { pages: [{ data: [fixtures.stream({ id: "twitch-stream", platform: "twitch" })] }] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        data: { pages: [{ data: [fixtures.stream({ id: "kick-stream", platform: "kick" })] }] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);

      renderWithProviders(<CategoryDetailPage />);

      const platformGroup = screen.getByRole("group", { name: "Platform" });
      const platformLinks = within(platformGroup).getAllByRole("link");
      expect(platformLinks.map((link) => link.textContent)).toEqual(["All", "Twitch", "Kick"]);
      expect(within(platformGroup).getByRole("link", { name: "Kick" })).toHaveAttribute(
        "aria-current",
        "page"
      );
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams");
    });

    it("uses Following Platform colors for every selected scope", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "GTA V" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);

      const { rerender } = renderWithProviders(<CategoryDetailPage />);
      expect(screen.getByRole("link", { name: "All" })).toHaveClass("bg-white", "text-black");

      categorySearchState.platform = "twitch";
      rerender(<CategoryDetailPage />);
      expect(screen.getByRole("link", { name: "Twitch" })).toHaveClass(
        "bg-[#9146FF]",
        "text-white"
      );

      categorySearchState.platform = "kick";
      rerender(<CategoryDetailPage />);
      expect(screen.getByRole("link", { name: "Kick" })).toHaveClass("bg-[#53FC18]", "text-black");
    });

    it("reproduces language, tag, and viewer sorting from a deep-linked URL", () => {
      categorySearchState.language = "es";
      categorySearchState.tag = "ranked";
      categorySearchState.sort = "asc";
      categorySearchState.otherId = "15";
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "GTA V" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        data: {
          pages: [
            {
              data: [
                fixtures.stream({ id: "high", viewerCount: 900, tags: ["Ranked"] }),
                fixtures.stream({ id: "excluded", viewerCount: 1, tags: ["Casual"] }),
                fixtures.stream({ id: "low", viewerCount: 20, tags: ["ranked games"] }),
              ],
            },
          ],
        },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce(emptyInfinite());

      renderWithProviders(<CategoryDetailPage />);

      expect(useInfiniteStreamsByCategoryMock).toHaveBeenNthCalledWith(
        1,
        "cat-1",
        "twitch",
        30,
        undefined,
        "es",
        "all:es:ranked:asc"
      );
      expect(screen.getByDisplayValue("ranked")).toBeInTheDocument();
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("2 streams:low,high");
    });

    it("distinguishes a filtered-empty result from an empty Category", async () => {
      categorySearchState.tag = "speedrun";
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "GTA V" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        data: {
          pages: [{ data: [fixtures.stream({ id: "casual", tags: ["Casual"] })] }],
        },
      } as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce(emptyInfinite());

      renderWithProviders(<CategoryDetailPage />);

      await waitFor(() =>
        expect(screen.getByTestId("stream-grid")).toHaveTextContent(
          'No streams in this category match "speedrun".'
        )
      );
    });

    it("gives every Live filter an accessible text label", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Tag" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Viewer sort" })).toBeInTheDocument();
    });

    it("writes filter changes to the URL, preserves cross-Platform identity, and opens at content top", () => {
      categorySearchState.otherId = "15";
      const scrollArea = document.createElement("main");
      scrollArea.id = "main-content-scroll-area";
      scrollArea.scrollTop = 640;
      document.body.append(scrollArea);
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);

      renderWithProviders(<CategoryDetailPage />);
      fireEvent.change(screen.getByRole("textbox", { name: "Tag" }), {
        target: { value: "speedrun" },
      });

      expect(scrollArea.scrollTop).toBe(0);
      expect(categoryNavigateMock).toHaveBeenCalledWith({
        to: "/categories/$platform/$categoryId",
        params: { platform: "twitch", categoryId: "cat-1" },
        search: {
          tab: "live",
          platform: "all",
          language: "",
          tag: "speedrun",
          sort: "desc",
          otherId: "15",
        },
      });
      scrollArea.remove();
    });

    it.each([
      ["Clips", "tab", "clips"],
      ["Twitch", "platform", "twitch"],
    ] as const)(
      "keeps otherId in the %s URL and resets scroll for an ordinary click",
      (linkName, field, value) => {
        categorySearchState.otherId = "15";
        const scrollArea = document.createElement("main");
        scrollArea.id = "main-content-scroll-area";
        scrollArea.scrollTop = 640;
        document.body.append(scrollArea);
        useCategoryByIdMock.mockImplementation(
          (id, queryPlatform) =>
            ({
              data: fixtures.category({ id, platform: queryPlatform, name: "Just Chatting" }),
              isLoading: false,
            }) as ReturnType<typeof useCategoryById>
        );
        const preventDocumentNavigation = (event: Event) => event.preventDefault();
        document.addEventListener("click", preventDocumentNavigation);

        renderWithProviders(<CategoryDetailPage />);
        const link = screen.getByRole("link", { name: linkName });
        fireEvent.click(link);

        expect(scrollArea.scrollTop).toBe(0);
        expect(JSON.parse(link.getAttribute("data-search") ?? "{}")).toEqual(
          expect.objectContaining({ [field]: value, otherId: "15" })
        );
        document.removeEventListener("click", preventDocumentNavigation);
        scrollArea.remove();
      }
    );

    it("keeps raw tag text in the URL immediately but defers the upstream dataset until typing settles", () => {
      vi.useFakeTimers();
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);

      const { rerender } = renderWithProviders(<CategoryDetailPage />);
      fireEvent.change(screen.getByRole("textbox", { name: "Tag" }), {
        target: { value: "r" },
      });
      expect(categoryNavigateMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: expect.objectContaining({ tag: "r" }) })
      );

      categorySearchState.tag = "r";
      rerender(<CategoryDetailPage />);
      categorySearchState.tag = "ra";
      rerender(<CategoryDetailPage />);
      categorySearchState.tag = "ranked";
      rerender(<CategoryDetailPage />);

      expect(
        useInfiniteStreamsByCategoryMock.mock.calls
          .map((call) => call[5])
          .filter((key) => key?.includes(":r"))
      ).toEqual([]);

      act(() => vi.advanceTimersByTime(200));
      expect(
        useInfiniteStreamsByCategoryMock.mock.calls.some((call) => call[5] === "all::ranked:desc")
      ).toBe(true);
      vi.useRealTimers();
    });
  });
}

export function registerReliabilityTests() {
  registerCategoryDetailTests("loading, failure, and pagination", () => {
    it("keeps one Platform usable and offers a Platform-specific retry when the other fails", () => {
      const retryTwitch = vi.fn();
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        error: new Error("Twitch unavailable"),
        refetch: retryTwitch,
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        data: { pages: [{ data: [fixtures.stream({ id: "kick-live", platform: "kick" })] }] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByRole("status")).toHaveTextContent(/twitch.*unavailable/i);
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams:kick-live");
      fireEvent.click(screen.getByRole("button", { name: /retry twitch/i }));
      expect(retryTwitch).toHaveBeenCalledTimes(1);
    });

    it("surfaces a retryable secondary identity failure while keeping the primary Platform usable", async () => {
      categoryRouteState.platform = "kick";
      categoryRouteState.categoryId = "kick-irl";
      categorySearchState.otherId = "509658";
      const retryProvidedCategory = vi.fn();
      const api = installElectronAPIMock();
      api.categories.search = vi.fn<typeof api.categories.search>(async () => ({
        success: false,
        error: "Temporary category search failure",
        providers: { twitch: "failed" },
      }));
      useCategoryByIdMock.mockImplementation((_id, queryPlatform) =>
        queryPlatform === "kick"
          ? ({
              data: fixtures.category({ id: "kick-irl", platform: "kick", name: "IRL" }),
              isLoading: false,
              error: null,
            } as ReturnType<typeof useCategoryById>)
          : ({
              data: undefined,
              isLoading: false,
              error: new Error("Temporary provided-id failure"),
              refetch: retryProvidedCategory,
            } as unknown as ReturnType<typeof useCategoryById>)
      );
      useInfiniteStreamsByCategoryMock.mockImplementation((_id, queryPlatform) =>
        queryPlatform === "kick"
          ? ({
              ...emptyInfinite(),
              data: {
                pages: [{ data: [fixtures.stream({ id: "kick-live", platform: "kick" })] }],
              },
            } as ReturnType<typeof useInfiniteStreamsByCategory>)
          : emptyInfinite()
      );

      renderWithProviders(<CategoryDetailPage />);

      await waitFor(() => expect(api.categories.search).toHaveBeenCalledTimes(1));
      expect(useInfiniteStreamsByCategoryMock).toHaveBeenLastCalledWith(
        "",
        "twitch",
        30,
        undefined,
        undefined,
        "all:::desc"
      );
      expect(await screen.findByRole("status")).toHaveTextContent(
        /twitch streams are temporarily unavailable/i
      );
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams:kick-live");

      fireEvent.click(screen.getByRole("button", { name: /retry twitch/i }));

      await waitFor(() => expect(retryProvidedCategory).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(api.categories.search).toHaveBeenCalledTimes(2));
    });

    it("does not report an identity outage when the safe Kick name fallback returns streams", async () => {
      categorySearchState.otherId = "15";
      const api = installElectronAPIMock();
      api.categories.search = vi.fn<typeof api.categories.search>(async () => ({
        success: false,
        error: "Temporary category search failure",
        providers: { kick: "failed" },
      }));
      useCategoryByIdMock.mockImplementation((_id, queryPlatform) =>
        queryPlatform === "twitch"
          ? ({
              data: fixtures.category({
                id: "cat-1",
                platform: "twitch",
                name: "Just Chatting",
              }),
              isLoading: false,
              error: null,
            } as ReturnType<typeof useCategoryById>)
          : ({
              data: undefined,
              isLoading: false,
              error: new Error("Temporary provided-id failure"),
              refetch: vi.fn(),
            } as unknown as ReturnType<typeof useCategoryById>)
      );
      useInfiniteStreamsByCategoryMock.mockImplementation((_id, queryPlatform, _limit, name) =>
        queryPlatform === "kick" && name === "Just Chatting"
          ? ({
              ...emptyInfinite(),
              data: {
                pages: [{ data: [fixtures.stream({ id: "kick-live", platform: "kick" })] }],
              },
            } as ReturnType<typeof useInfiniteStreamsByCategory>)
          : emptyInfinite()
      );

      renderWithProviders(<CategoryDetailPage />);

      await waitFor(() => expect(api.categories.search).toHaveBeenCalledTimes(1));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams:kick-live");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("shows an outage instead of an empty state when the selected Platform fails without cached rows", () => {
      categorySearchState.platform = "kick";
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce(emptyInfinite());
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        error: new Error("Kick unavailable"),
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByRole("status")).toHaveTextContent(/kick.*unavailable/i);
      expect(screen.queryByTestId("stream-grid")).not.toBeInTheDocument();
      expect(screen.queryByText(/no live kick streams/i)).not.toBeInTheDocument();
    });

    it("keeps All in loading state when one visible Platform fails while the other is pending", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        error: new Error("Twitch unavailable"),
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        isLoading: true,
      } as ReturnType<typeof useInfiniteStreamsByCategory>);

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByRole("status")).toHaveTextContent(/twitch.*unavailable/i);
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("loading");
      expect(screen.queryByText(/no active streams/i)).not.toBeInTheDocument();
    });

    it("does not surface an unselected Platform failure over the selected feed", () => {
      categorySearchState.platform = "twitch";
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        data: { pages: [{ data: [fixtures.stream({ id: "twitch-live" })] }] },
      } as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        error: new Error("Kick unavailable"),
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams:twitch-live");
    });

    it("paginates only the selected Platform while retaining independent cursors", () => {
      let intersectionCallback: IntersectionObserverCallback | undefined;
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(callback: IntersectionObserverCallback) {
            intersectionCallback = callback;
          }
          observe() {}
          unobserve() {}
          disconnect() {}
          takeRecords() {
            return [];
          }
          root = null;
          rootMargin = "";
          thresholds = [];
        }
      );
      categorySearchState.platform = "twitch";
      const fetchTwitchPage = vi.fn();
      const fetchKickPage = vi.fn();
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        hasNextPage: true,
        fetchNextPage: fetchTwitchPage,
      } as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        hasNextPage: true,
        fetchNextPage: fetchKickPage,
      } as ReturnType<typeof useInfiniteStreamsByCategory>);

      renderWithProviders(<CategoryDetailPage />);
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );

      expect(fetchTwitchPage).toHaveBeenCalledTimes(1);
      expect(fetchKickPage).not.toHaveBeenCalled();
    });

    it("continues the unexhausted Platform when the other side of All has no next page", () => {
      let intersectionCallback: IntersectionObserverCallback | undefined;
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(callback: IntersectionObserverCallback) {
            intersectionCallback = callback;
          }
          observe() {}
          unobserve() {}
          disconnect() {}
          takeRecords() {
            return [];
          }
          root = null;
          rootMargin = "";
          thresholds = [];
        }
      );
      const fetchTwitchPage = vi.fn();
      const fetchKickPage = vi.fn();
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        hasNextPage: false,
        fetchNextPage: fetchTwitchPage,
      } as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        hasNextPage: true,
        fetchNextPage: fetchKickPage,
      } as ReturnType<typeof useInfiniteStreamsByCategory>);

      renderWithProviders(<CategoryDetailPage />);
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );

      expect(fetchTwitchPage).not.toHaveBeenCalled();
      expect(fetchKickPage).toHaveBeenCalledTimes(1);
    });

    it("shows the loading state for the selected Platform dataset", () => {
      categorySearchState.platform = "kick";
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce(emptyInfinite());
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        isLoading: true,
      } as ReturnType<typeof useInfiniteStreamsByCategory>);

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByTestId("stream-grid")).toHaveTextContent("loading");
    });

    it("announces pagination progress and disables spinner motion when reduced motion is requested", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
        ...emptyInfinite(),
        hasNextPage: true,
        isFetchingNextPage: true,
      } as ReturnType<typeof useInfiniteStreamsByCategory>);
      useInfiniteStreamsByCategoryMock.mockReturnValueOnce(emptyInfinite());

      renderWithProviders(<CategoryDetailPage />);

      const paginationStatus = screen.getByRole("status", { name: "Loading more live streams" });
      expect(paginationStatus).toHaveTextContent("Loading more live streams");
      expect(paginationStatus.querySelector(".animate-spin")).toHaveClass(
        "motion-reduce:animate-none"
      );
    });

    it("immediately reorders visible Streams when Live Viewer Counts change", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      let twitchResult = {
        ...emptyInfinite(),
        data: {
          pages: [
            {
              data: [
                fixtures.stream({ id: "alpha", viewerCount: 900 }),
                fixtures.stream({ id: "beta", viewerCount: 100 }),
              ],
            },
          ],
        },
      } as ReturnType<typeof useInfiniteStreamsByCategory>;
      useInfiniteStreamsByCategoryMock.mockImplementation((_id, queryPlatform) =>
        queryPlatform === "twitch" ? twitchResult : emptyInfinite()
      );

      const { rerender } = renderWithProviders(<CategoryDetailPage />);
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("2 streams:alpha,beta");

      twitchResult = {
        ...twitchResult,
        data: {
          pages: [
            {
              data: [
                fixtures.stream({ id: "alpha", viewerCount: 50 }),
                fixtures.stream({ id: "beta", viewerCount: 1000 }),
              ],
            },
          ],
        },
      } as ReturnType<typeof useInfiniteStreamsByCategory>;
      rerender(<CategoryDetailPage />);

      expect(screen.getByTestId("stream-grid")).toHaveTextContent("2 streams:beta,alpha");
    });

    it("names an empty selected Platform instead of presenting a generic Category empty state", () => {
      categorySearchState.platform = "kick";
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Just Chatting" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);

      renderWithProviders(<CategoryDetailPage />);

      expect(screen.getByTestId("stream-grid")).toHaveTextContent(
        "No live Kick streams found for this category."
      );
    });

    it("error: useCategoryById returns data=undefined (Helix 5xx) → streams grid still mounts so users can browse live streams while metadata recovers", () => {
      useCategoryByIdMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
        typeof useCategoryById
      >);
      useInfiniteStreamsByCategoryMock.mockReturnValue({
        data: { pages: [{ data: [fixtures.stream({ id: "a" })] }] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
      } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
      renderWithProviders(<CategoryDetailPage />);
      expect(screen.getByTestId("stream-grid")).toHaveTextContent("1 streams");
    });

    it("empty: no live streams in either platform fan-out → grid renders the empty-message branch (distinct from loading via absent .animate-pulse)", () => {
      useCategoryByIdMock.mockReturnValue({
        data: fixtures.category({ name: "Empty Cat" }),
        isLoading: false,
      } as ReturnType<typeof useCategoryById>);
      // Default emptyInfinite() returns pages=[] — both calls. The mocked
      // StreamGrid renders its `emptyMessage` prop when streams.length === 0.
      const { container } = renderWithProviders(<CategoryDetailPage />);
      expect(screen.getByTestId("stream-grid")).toHaveTextContent(/no active streams found/i);
      // The category header skeleton must NOT be on screen — distinguishes
      // empty-but-loaded from still-loading.
      expect(container.querySelector(".animate-pulse")).toBeNull();
    });
  });
}
