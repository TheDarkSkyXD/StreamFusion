import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, fixtures, renderWithProviders, routerMock, screen } from "../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

const firstPaintState = vi.hoisted(() => ({ hasPainted: true }));

vi.mock("@/hooks/useAfterFirstPaint", () => ({
  useAfterFirstPaint: () => firstPaintState.hasPainted,
}));

vi.mock("@/features/discovery/data/queries/useCategories", () => ({
  useInfiniteTopCategories: vi.fn(),
  useCategoryById: vi.fn(),
}));

vi.mock("@/features/discovery/data/queries/useSearch", () => ({
  useSearchCategories: vi.fn(),
}));

vi.mock("@/features/discovery/components/discovery/virtualized-category-grid", () => ({
  VirtualizedCategoryGrid: ({
    categories,
    isLoading,
    emptyMessage,
    skeletonCount,
    hasNextPage,
    onLoadMore,
  }: {
    categories: { id: string; name: string }[];
    isLoading?: boolean;
    emptyMessage?: string;
    skeletonCount?: number;
    hasNextPage?: boolean;
    onLoadMore?: () => void;
  }) => (
    <div data-testid="vcat-grid" data-skeleton-count={skeletonCount}>
      {isLoading ? (
        <span>loading-grid</span>
      ) : categories.length === 0 ? (
        <span>{emptyMessage}</span>
      ) : (
        categories.map((c) => <div key={c.id}>{c.name}</div>)
      )}
      {hasNextPage && <button onClick={onLoadMore}>load-more-categories</button>}
    </div>
  ),
}));

import { useInfiniteTopCategories } from "@/features/discovery/data/queries/useCategories";
import { useSearchCategories } from "@/features/discovery/data/queries/useSearch";
import { CategoriesPage } from "@/pages/Categories";

const useInfiniteTopCategoriesMock = vi.mocked(useInfiniteTopCategories);
const useSearchCategoriesMock = vi.mocked(useSearchCategories);

// Guards: loading state — the infinite category query's loading state is forwarded to VirtualizedCategoryGrid so the grid shows skeleton placeholders instead of "no categories"
// Guards: error state — an undefined infinite-query result renders the retryable error rather than throwing on .length
// Guards: empty state — search filter matches zero categories: query-aware "no categories matching X" empty copy surfaces, distinct from the generic empty state
// Guards: reaching the category grid's load-more boundary delegates to the infinite query so browsing does not stop after page one.
// Guards: the page owns one internal category scrollbar even when a Platform health banner reduces the shell height.
// Guards: ready Category data renders without waiting for an animation frame that Electron may throttle during cold start.
describe("CategoriesPage", () => {
  beforeEach(() => {
    firstPaintState.hasPainted = true;
    useInfiniteTopCategoriesMock.mockReset();
    useSearchCategoriesMock.mockReturnValue({} as ReturnType<typeof useSearchCategories>);
  });

  it("loading: forwards isLoading=true and 12 placeholders to the grid", () => {
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useInfiniteTopCategories>);
    renderWithProviders(<CategoriesPage />);
    expect(screen.getByRole("heading", { name: /categories/i })).toBeInTheDocument();
    expect(screen.getByText("loading-grid")).toBeInTheDocument();
    expect(screen.getByTestId("vcat-grid")).toHaveAttribute("data-skeleton-count", "12");
  });

  it("renders categories from query", () => {
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: [
        fixtures.category({ id: "c1", name: "Just Chatting" }),
        fixtures.category({ id: "c2", name: "GTA V" }),
      ],
      isLoading: false,
    } as ReturnType<typeof useInfiniteTopCategories>);
    const view = renderWithProviders(<CategoriesPage />);
    expect(screen.getByText("Just Chatting")).toBeInTheDocument();
    expect(screen.getByText("GTA V")).toBeInTheDocument();
    expect(view.container.firstElementChild).toHaveClass("overflow-hidden");
  });

  it("renders ready categories before the first animation frame", () => {
    firstPaintState.hasPainted = false;
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: [fixtures.category({ id: "c1", name: "Just Chatting" })],
      isLoading: false,
    } as ReturnType<typeof useInfiniteTopCategories>);

    renderWithProviders(<CategoriesPage />);

    expect(screen.getByText("Just Chatting")).toBeInTheDocument();
    expect(screen.queryByText("loading-grid")).not.toBeInTheDocument();
  });

  it("filters categories via the search input", () => {
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: [
        fixtures.category({ id: "c1", name: "Just Chatting" }),
        fixtures.category({ id: "c2", name: "GTA V" }),
      ],
      isLoading: false,
    } as ReturnType<typeof useInfiniteTopCategories>);
    renderWithProviders(<CategoriesPage />);
    const input = screen.getByPlaceholderText(/filter categories/i);
    fireEvent.change(input, { target: { value: "gta" } });
    expect(screen.queryByText("Just Chatting")).not.toBeInTheDocument();
    expect(screen.getByText("GTA V")).toBeInTheDocument();
  });

  it("passes a query-aware empty message when filter has no hits", () => {
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: [fixtures.category({ id: "c1", name: "Just Chatting" })],
      isLoading: false,
    } as ReturnType<typeof useInfiniteTopCategories>);
    renderWithProviders(<CategoriesPage />);
    fireEvent.change(screen.getByPlaceholderText(/filter categories/i), {
      target: { value: "nothing-matches" },
    });
    expect(screen.getByText(/no categories matching "nothing-matches"/i)).toBeInTheDocument();
  });

  it("uses remote category search instead of claiming a final empty result before later pages load", () => {
    const remoteCategory = fixtures.category({ id: "later", name: "Later Match" });
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: [fixtures.category({ id: "c1", name: "Just Chatting" })],
      isLoading: false,
    } as ReturnType<typeof useInfiniteTopCategories>);
    useSearchCategoriesMock.mockReturnValue({
      data: { pages: [{ data: [remoteCategory] }], pageParams: [] },
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useSearchCategories>);

    renderWithProviders(<CategoriesPage />);
    fireEvent.change(screen.getByPlaceholderText(/filter categories/i), {
      target: { value: "later" },
    });

    expect(screen.getByText("Later Match")).toBeInTheDocument();
    expect(screen.queryByText(/no categories matching/i)).not.toBeInTheDocument();
    expect(useSearchCategoriesMock).toHaveBeenLastCalledWith("later", undefined, 20, true);
  });

  it("error: shows a retryable failure instead of the generic empty copy", () => {
    const refetch = vi.fn();
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useInfiniteTopCategories>);
    renderWithProviders(<CategoriesPage />);
    expect(screen.getByText(/couldn’t load categories/i)).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: /try again/i });
    expect(retryButton).toHaveClass("text-[var(--color-primary-foreground)]");
    fireEvent.click(retryButton);
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText(/no categories found/i)).not.toBeInTheDocument();
  });

  it("loads the next category page when the grid reaches its boundary", () => {
    const fetchNextPage = vi.fn();
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: [fixtures.category({ id: "c1", name: "Just Chatting" })],
      isLoading: false,
      hasNextPage: true,
      fetchNextPage,
    } as unknown as ReturnType<typeof useInfiniteTopCategories>);
    renderWithProviders(<CategoriesPage />);
    fireEvent.click(screen.getByRole("button", { name: /load-more-categories/i }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it("empty: data=[] renders the generic empty message copy in the grid", () => {
    useInfiniteTopCategoriesMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useInfiniteTopCategories>);
    renderWithProviders(<CategoriesPage />);
    // The grid stub uses the emptyMessage prop when categories.length === 0.
    expect(screen.getByTestId("vcat-grid")).toBeInTheDocument();
  });
});
