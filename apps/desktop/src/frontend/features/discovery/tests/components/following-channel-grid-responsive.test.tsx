import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FollowingChannelGrid } from "@/features/discovery/components/screens/Following/following-channel-grid";

// Guards: resizing a scrolled Following grid recalculates virtual rows from the same columns shown on screen.
describe("FollowingChannelGrid responsive rows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses measured container width for both card columns and virtual placement", () => {
    let width = 1200;
    const observers: TestResizeObserver[] = [];
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 392);

    class TestResizeObserver {
      private target: Element | null = null;

      constructor(private callback: ResizeObserverCallback) {
        observers.push(this);
      }

      observe(target: Element) {
        this.target = target;
      }

      disconnect() {}

      unobserve() {}

      resize(nextWidth: number) {
        if (!this.target) return;
        width = nextWidth;
        const entry: ResizeObserverEntry = {
          target: this.target,
          contentRect: DOMRectReadOnly.fromRect({ width }),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        };
        this.callback([entry], this);
      }
    }

    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const items = Array.from({ length: 100 }, (_, index) => index);
    render(
      <FollowingChannelGrid
        items={items}
        getItemKey={(item) => String(item)}
        renderItem={(item) => <span>channel-{item}</span>}
      />
    );

    const grid = screen.getByTestId("following-channel-grid");
    grid.scrollTop = 1764;
    fireEvent.scroll(grid);
    expect(grid.querySelector(".grid")).toHaveStyle({
      gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
    });
    expect(screen.getByText("channel-64")).toBeInTheDocument();

    act(() => observers[0]?.resize(390));
    expect(grid.querySelector(".grid")).toHaveStyle({
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    });
    expect(screen.getByText("channel-16")).toBeInTheDocument();
  });
});
