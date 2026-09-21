import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, fixtures, renderWithProviders, routerMock, screen } from "../../../../../../tests/test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/features/discovery/components/stream/stream-grid", () => ({
  StreamGrid: ({ streams }: { streams?: unknown[] }) => (
    <div data-testid="stream-grid">{streams?.length ?? 0} streams</div>
  ),
}));

import { LiveNowSection } from "@/features/discovery/components/screens/Home/components/live-now-section";

function installIntersectionObserverMock() {
  const callbacks: IntersectionObserverCallback[] = [];
  const OriginalIntersectionObserver = globalThis.IntersectionObserver;

  class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly scrollMargin = "";
    readonly thresholds = [];
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback);
    }
    disconnect() {}
    observe() {}
    takeRecords() {
      return [];
    }
    unobserve() {}
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

  return {
    restore() {
      vi.stubGlobal("IntersectionObserver", OriginalIntersectionObserver);
    },
    trigger(isIntersecting: boolean) {
      for (const callback of callbacks) {
        callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    },
  };
}

// Guards: Home live channels fetch the next page from a scroll sentinel instead of a Load more button
// Guards: a failed next-page fetch shows retry and does not auto-request again until the user retries
describe("LiveNowSection infinite scroll", () => {
  let observer: ReturnType<typeof installIntersectionObserverMock>;

  beforeEach(() => {
    observer = installIntersectionObserverMock();
  });

  afterEach(() => {
    observer.restore();
  });

  it("loads more live channels when the scroll sentinel enters view", () => {
    const onLoadMore = vi.fn();
    renderWithProviders(
      <LiveNowSection
        streams={[fixtures.stream({ id: "s1" })]}
        isLoading={false}
        hasNextPage
        onLoadMore={onLoadMore}
      />
    );

    expect(screen.queryByRole("button", { name: /load more live channels/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("live-channels-infinite-sentinel")).toBeInTheDocument();

    observer.trigger(true);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("does not auto-fetch after a load-more failure until retry is clicked", () => {
    const onLoadMore = vi.fn();
    renderWithProviders(
      <LiveNowSection
        streams={[fixtures.stream({ id: "s1" })]}
        isLoading={false}
        hasNextPage
        loadMoreError
        onLoadMore={onLoadMore}
      />
    );

    expect(screen.queryByRole("button", { name: /load more live channels/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("live-channels-infinite-sentinel")).not.toBeInTheDocument();

    observer.trigger(true);
    expect(onLoadMore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /retry loading live channels/i }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
