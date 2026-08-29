import { describe, expect, it, vi } from "vitest";

import { fixtures, renderWithProviders, routerMock, screen } from "../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/features/discovery/components/stream/stream-card", () => ({
  StreamCard: ({ stream, isWatching }: { stream: { title: string }; isWatching?: boolean }) => (
    <div data-testid="stream-card" data-watching={isWatching ? "true" : "false"}>
      {stream.title}
    </div>
  ),
}));

vi.mock("@/features/discovery/components/stream/stream-card-skeleton", () => ({
  StreamCardSkeleton: () => <div data-testid="stream-skeleton" />,
}));

import { StreamGrid } from "@/features/discovery/components/stream/stream-grid";

// Guards: loading state — N skeletons render (count matches `skeletons` prop), distinct from empty/error so the layout doesn't flicker between modes
// Guards: error/empty state — undefined OR empty streams array renders the emptyMessage card with the TV icon; consumers pass error-specific copy via emptyMessage so users distinguish "no streams" from "search broke"
// Guards: watched-state wiring - only the stream matching the current PiP platform/channel is marked selected in the grid.
// Note: this is the canonical grid-clone test post-U20.d consolidation. The previous duplicate triplet (category-grid, virtualized-category-grid) was removed as redundant per AGENTS.md R13.
describe("StreamGrid", () => {
  it("loading: renders skeletons when isLoading is true", () => {
    renderWithProviders(<StreamGrid isLoading skeletons={3} />);
    expect(screen.getAllByTestId("stream-skeleton")).toHaveLength(3);
  });

  it("empty: renders the consumer-supplied emptyMessage when streams=[]", () => {
    renderWithProviders(<StreamGrid streams={[]} emptyMessage="Nothing live" />);
    expect(screen.getByText("Nothing live")).toBeInTheDocument();
  });

  it("error path (undefined streams) renders the emptyMessage too — same surface as empty", () => {
    // React Query exposes failed queries as data=undefined; the page passes
    // streams={undefined} when its query errored. The grid renders the empty
    // card with the consumer's error-aware copy.
    renderWithProviders(<StreamGrid emptyMessage="Couldn't load streams" />);
    expect(screen.getByText(/couldn't load streams/i)).toBeInTheDocument();
  });

  it("renders one StreamCard per stream", () => {
    renderWithProviders(
      <StreamGrid
        streams={[
          fixtures.stream({ id: "1", title: "A" }),
          fixtures.stream({ id: "2", title: "B" }),
        ]}
      />
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("marks only the matching active stream as watching", () => {
    renderWithProviders(
      <StreamGrid
        activeStream={{ platform: "kick", channelName: "SelectedChannel" }}
        streams={[
          fixtures.stream({
            id: "1",
            platform: "kick",
            channelName: "selectedchannel",
            title: "Selected",
          }),
          fixtures.stream({
            id: "2",
            platform: "twitch",
            channelName: "selectedchannel",
            title: "Other platform",
          }),
        ]}
      />
    );

    expect(screen.getByText("Selected")).toHaveAttribute("data-watching", "true");
    expect(screen.getByText("Other platform")).toHaveAttribute("data-watching", "false");
  });
});
