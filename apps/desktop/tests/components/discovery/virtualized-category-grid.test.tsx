import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtures, renderWithProviders, screen } from "../../test-utils";

vi.mock("@/components/discovery/category-card", () => ({
  CategoryCard: ({
    category,
    imageLoading,
    imageFetchPriority,
  }: {
    category: { name: string };
    imageLoading?: "lazy" | "eager";
    imageFetchPriority?: "high" | "low" | "auto";
  }) => (
    <div
      data-testid="category-card"
      data-image-loading={imageLoading}
      data-image-priority={imageFetchPriority}
    >
      {category.name}
    </div>
  ),
}));

vi.mock("@/components/discovery/category-card-skeleton", () => ({
  CategoryCardSkeleton: () => <div data-testid="category-skeleton" />,
}));

import { VirtualizedCategoryGrid } from "@/components/discovery/virtualized-category-grid";

function categoryDataset(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) =>
    fixtures.category({ id: `${prefix}-${index}`, name: `${prefix} ${index}` })
  );
}

// Guards: large category results keep only the viewport window mounted instead of decoding the full catalog.
// Guards: switching to a different ordered dataset resets synchronously to the first bounded window.
// Guards: scrolling replaces the mounted window with the newly visible categories.
// Guards: replacing the loading skeleton with the scroll container attaches the load-more listener so page two can be requested.
describe("VirtualizedCategoryGrid progressive rendering", () => {
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight"
  );
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight"
  );

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
  });

  it("keeps a large result bounded to the visible window", () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 280,
    });

    renderWithProviders(
      <VirtualizedCategoryGrid
        categories={categoryDataset("Category", 1_000)}
        datasetKey="all-1000"
        overscan={0}
      />
    );

    expect(screen.getAllByTestId("category-card").length).toBeLessThanOrEqual(8);
    expect(screen.queryByText("Category 8")).not.toBeInTheDocument();
    expect(screen.queryByText("Category 999")).not.toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("category-card")
        .every(
          (card) => card.dataset.imageLoading === "eager" && card.dataset.imagePriority === "high"
        )
    ).toBe(true);
  });

  it("resets to the first bounded window when dataset identity changes", () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 280,
    });

    const view = renderWithProviders(
      <VirtualizedCategoryGrid
        categories={categoryDataset("A", 50)}
        datasetKey="dataset-a"
        overscan={0}
      />
    );
    const scrollContainer = view.container.querySelector<HTMLElement>('[style*="contain"]');
    expect(scrollContainer).not.toBeNull();
    if (scrollContainer) {
      scrollContainer.scrollTop = 1_400;
      fireEvent.scroll(scrollContainer);
    }
    expect(screen.queryByText("A 25")).toBeInTheDocument();

    view.rerender(
      <VirtualizedCategoryGrid
        categories={categoryDataset("B", 50)}
        datasetKey="dataset-b"
        overscan={0}
      />
    );

    expect(screen.getAllByTestId("category-card")).toHaveLength(8);
    expect(screen.getByText("B 7")).toBeInTheDocument();
    expect(screen.queryByText("B 8")).not.toBeInTheDocument();
    expect(screen.queryByText("A 0")).not.toBeInTheDocument();
  });

  it("replaces the mounted window when the user scrolls", () => {
    Object.defineProperties(HTMLElement.prototype, {
      clientHeight: {
        configurable: true,
        get: () => 280,
      },
      scrollHeight: {
        configurable: true,
        get: () => 2_800,
      },
    });
    const view = renderWithProviders(
      <VirtualizedCategoryGrid
        categories={categoryDataset("Category", 50)}
        datasetKey="scrolling-50"
        overscan={0}
      />
    );
    const scrollContainer = view.container.querySelector<HTMLElement>('[style*="contain"]');
    expect(scrollContainer).not.toBeNull();

    if (scrollContainer) {
      scrollContainer.scrollTop = 1_400;
      fireEvent.scroll(scrollContainer);
    }

    expect(screen.queryByTestId("category-skeleton")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("category-card").map((card) => card.textContent)).toEqual([
      "Category 25",
      "Category 26",
      "Category 27",
      "Category 28",
      "Category 29",
    ]);
  });

  it("attaches infinite scrolling after the loading state resolves", () => {
    Object.defineProperties(HTMLElement.prototype, {
      clientHeight: { configurable: true, get: () => 500 },
      scrollHeight: { configurable: true, get: () => 1_000 },
    });
    const onLoadMore = vi.fn();
    const view = renderWithProviders(
      <VirtualizedCategoryGrid
        categories={categoryDataset("Category", 20)}
        isLoading
        hasNextPage
        onLoadMore={onLoadMore}
      />
    );

    view.rerender(
      <VirtualizedCategoryGrid
        categories={categoryDataset("Category", 20)}
        hasNextPage
        onLoadMore={onLoadMore}
      />
    );
    const scrollContainer = view.container.querySelector<HTMLElement>('[style*="contain"]');
    expect(scrollContainer).not.toBeNull();
    onLoadMore.mockClear();

    if (scrollContainer) {
      scrollContainer.scrollTop = 500;
      fireEvent.scroll(scrollContainer);
    }

    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
