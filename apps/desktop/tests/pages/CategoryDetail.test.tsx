import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
} from "../test-utils";

vi.mock("@tanstack/react-router", () =>
  routerMock({ params: { platform: "twitch", categoryId: "cat-1" }, search: {} })
);

vi.mock("@/features/discovery/data/queries/useCategories", () => ({
  useCategoryById: vi.fn(),
  useInfiniteTopCategories: vi.fn(),
}));

vi.mock("@/features/discovery/data/queries/useInfiniteStreams", () => ({
  useInfiniteStreamsByCategory: vi.fn(),
}));

vi.mock("@/features/discovery/components/stream/stream-grid", () => ({
  StreamGrid: ({
    streams,
    isLoading,
    emptyMessage,
  }: {
    streams: unknown[];
    isLoading?: boolean;
    emptyMessage?: string;
  }) => (
    <div data-testid="stream-grid">
      {isLoading ? "loading" : streams.length === 0 ? emptyMessage : `${streams.length} streams`}
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

function emptyInfinite() {
  return {
    data: { pages: [] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>;
}

// Guards: loading state — useCategoryById isLoading=true renders the .animate-pulse header skeleton so the page doesn't flash an empty header before the box art arrives
// Guards: error state — useCategoryById returns data=undefined → category name "Unknown Category" surfaces; the streams grid still mounts so users can see live streams while the category metadata recovers
// Guards: empty state — useInfiniteStreamsByCategory returns pages=[] for both primary + secondary → streams grid shows 0 streams; distinct from loading via the absent .animate-pulse
// Guards: the watching-live total adds newly loaded secondary-platform viewers before the merged catalog finishes.
// Guards: duplicate stream rows across pages do not inflate the watching-live total.
describe("CategoryDetailPage", () => {
  beforeEach(() => {
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

  it("loading: renders the .animate-pulse header skeleton while category is loading", () => {
    useCategoryByIdMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useCategoryById
    >);
    const { container } = renderWithProviders(<CategoryDetailPage />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
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

  it("uses the same merged viewer count shown on the category card", () => {
    useCategoryByIdMock.mockReturnValue({
      data: fixtures.category({ name: "IRL", viewerCount: 111 }),
      isLoading: false,
    } as ReturnType<typeof useCategoryById>);
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: [fixtures.category({ name: "irl", viewerCount: 777, crossPlatformId: "kick-irl" })],
      isLoading: false,
    } as unknown as ReturnType<typeof useInfiniteTopCategories>);

    renderWithProviders(<CategoryDetailPage />);

    expect(screen.getByText("777")).toBeInTheDocument();
    expect(screen.queryByText("111")).not.toBeInTheDocument();
  });

  it("updates the watching-live total when secondary-platform streams arrive first", () => {
    useCategoryByIdMock.mockReturnValue({
      data: fixtures.category({ name: "IRL", viewerCount: 111 }),
      isLoading: false,
    } as ReturnType<typeof useCategoryById>);
    useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
      data: {
        pages: [
          {
            data: [fixtures.stream({ id: "twitch-stream", platform: "twitch", viewerCount: 50 })],
          },
        ],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
    useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
      data: {
        pages: [
          {
            data: [fixtures.stream({ id: "kick-stream", platform: "kick", viewerCount: 20 })],
          },
        ],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);

    renderWithProviders(<CategoryDetailPage />);

    expect(screen.getByText("131")).toBeInTheDocument();
    expect(screen.queryByText("111")).not.toBeInTheDocument();
  });

  it("does not count a repeated secondary-platform stream twice", () => {
    useCategoryByIdMock.mockReturnValue({
      data: fixtures.category({ name: "IRL", viewerCount: 111 }),
      isLoading: false,
    } as ReturnType<typeof useCategoryById>);
    useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
      data: {
        pages: [
          {
            data: [fixtures.stream({ id: "twitch-stream", platform: "twitch", viewerCount: 50 })],
          },
        ],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
    useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
      data: {
        pages: [
          {
            data: [fixtures.stream({ id: "kick-stream", platform: "kick", viewerCount: 20 })],
          },
          {
            data: [fixtures.stream({ id: "kick-stream", platform: "kick", viewerCount: 20 })],
          },
        ],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);

    renderWithProviders(<CategoryDetailPage />);

    expect(screen.getByTestId("stream-grid")).toHaveTextContent("2 streams");
    expect(screen.getByText("131")).toBeInTheDocument();
    expect(screen.queryByText("151")).not.toBeInTheDocument();
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
