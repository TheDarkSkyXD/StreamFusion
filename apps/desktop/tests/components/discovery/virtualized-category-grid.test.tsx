import { act, fireEvent } from "@testing-library/react";
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

// Guards: a 50-category result mounts only the eight startup-prewarmed cards initially, then preserves order while eventually exposing every result in bounded paint batches.
// Guards: switching to a different ordered dataset resets synchronously and an already-dequeued callback from the old dataset cannot reveal extra cards.
// Guards: scrolling into an unrevealed category window shows skeleton cards until that render batch is ready.
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

  it("reveals all 50 ordered categories after an eight-card first batch", () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 1_600,
    });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    renderWithProviders(
      <VirtualizedCategoryGrid categories={categoryDataset("Category", 50)} datasetKey="all-50" />
    );

    expect(screen.getAllByTestId("category-card")).toHaveLength(8);
    expect(screen.queryByText("Category 8")).not.toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("category-card")
        .every(
          (card) => card.dataset.imageLoading === "eager" && card.dataset.imagePriority === "high"
        )
    ).toBe(true);

    while (screen.getAllByTestId("category-card").length < 50) {
      const frame = frames.shift();
      expect(frame).toBeDefined();
      act(() => frame?.(0));
    }

    expect(screen.getAllByTestId("category-card")).toHaveLength(50);
    expect(screen.getAllByTestId("category-card").map((card) => card.textContent)).toEqual(
      Array.from({ length: 50 }, (_, index) => `Category ${index}`)
    );
  });

  it("resets on dataset identity and rejects a stale append callback", () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 1_600,
    });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const view = renderWithProviders(
      <VirtualizedCategoryGrid categories={categoryDataset("A", 50)} datasetKey="dataset-a" />
    );
    const staleDatasetAFrame = frames.shift();
    expect(staleDatasetAFrame).toBeDefined();

    view.rerender(
      <VirtualizedCategoryGrid categories={categoryDataset("B", 50)} datasetKey="dataset-b" />
    );

    expect(screen.getAllByTestId("category-card")).toHaveLength(8);
    expect(screen.getByText("B 7")).toBeInTheDocument();
    expect(screen.queryByText("B 8")).not.toBeInTheDocument();
    expect(screen.queryByText("A 0")).not.toBeInTheDocument();

    act(() => staleDatasetAFrame?.(0));
    expect(screen.getAllByTestId("category-card")).toHaveLength(8);
    expect(screen.queryByText("B 8")).not.toBeInTheDocument();
  });

  it("shows skeletons while a newly scrolled category window is pending", () => {
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
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

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

    expect(screen.getAllByTestId("category-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Category 25")).not.toBeInTheDocument();

    while (!screen.queryByText("Category 25")) {
      const frame = frames.shift();
      expect(frame).toBeDefined();
      act(() => frame?.(0));
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
