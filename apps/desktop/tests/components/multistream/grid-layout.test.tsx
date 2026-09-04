import { describe, expect, it, vi } from "vitest";

import {
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from "../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

let mockState = {
  streams: [] as Array<{ id: string; platform: string; channelName: string }>,
  layout: "grid" as "grid" | "focus",
  focusedStreamId: null as string | null,
  playbackBudget: 4,
};

vi.mock("@/features/multistream/data/multistream-store", () => ({
  useMultiStreamStore: (selector: (state: unknown) => unknown) =>
    selector({
      ...mockState,
      removeStream: vi.fn(),
      setFocusedStream: vi.fn(),
      toggleMute: vi.fn(),
      reorderStreams: vi.fn(),
    }),
}));

vi.mock("@/features/multistream/components/multistream/sortable-stream-slot", () => ({
  SortableStreamSlot: ({
    channelName,
    playbackActive,
    wcvEnabled,
  }: {
    channelName: string;
    playbackActive?: boolean;
    wcvEnabled?: boolean | null;
  }) => (
    <div
      data-testid="sortable-slot"
      data-playback-active={String(playbackActive)}
      data-wcv-enabled={String(wcvEnabled)}
    >
      {channelName}
    </div>
  ),
}));

vi.mock("@/features/multistream/components/multistream/adaptive-stream-grid", () => ({
  AspectAwareStreamGrid: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="aspect-aware-grid">{children}</div>
  ),
}));

vi.mock("@/features/multistream/components/multistream/stream-slot", () => ({
  StreamSlot: () => <div data-testid="slot">slot</div>,
}));

import { MultiStreamGrid } from "@/features/multistream/components/multistream/grid-layout";

// Guards: empty state — no streams in the store → render "no active streams" empty card; otherwise the user lands on multistream with no signal anything's there
// Guards: per-slot isolation — one SortableStreamSlot renders per stream regardless of any slot's individual HLS state. The grid mounts all slots so one failing slot can't unmount its siblings
// Guards: partial loading — with N streams, all N sortable slots mount; a slot that's still mounting renders alongside an already-live slot (no blocking)
describe("MultiStreamGrid", () => {
  it("empty: no streams renders the empty-card", () => {
    mockState = { streams: [], layout: "grid", focusedStreamId: null, playbackBudget: 4 };
    renderWithProviders(<MultiStreamGrid />);
    expect(screen.getByText(/no active streams/i)).toBeInTheDocument();
  });

  it("renders one slot per stream", () => {
    mockState = {
      streams: [
        { id: "s1", platform: "twitch", channelName: "ninja" },
        { id: "s2", platform: "kick", channelName: "xqc" },
      ],
      layout: "grid",
      focusedStreamId: null,
      playbackBudget: 4,
    };
    renderWithProviders(<MultiStreamGrid />);
    expect(screen.getAllByTestId("sortable-slot")).toHaveLength(2);
    expect(screen.getByTestId("aspect-aware-grid")).toBeInTheDocument();
  });

  // Guards: a single Multiview stream also uses the aspect stage instead of stretching into a tall letterboxed player.
  it("keeps a single stream in an aspect-correct player frame", () => {
    mockState = {
      streams: [{ id: "s1", platform: "twitch", channelName: "ninja" }],
      layout: "grid",
      focusedStreamId: null,
      playbackBudget: 4,
    };

    renderWithProviders(<MultiStreamGrid />);

    expect(screen.getByTestId("sortable-slot")).toBeInTheDocument();
    expect(screen.getByTestId("aspect-aware-grid")).toBeInTheDocument();
  });

  // Guards: focus mode constrains the primary stream while retaining the existing aspect-video side rail.
  it("keeps the focused stream in the adaptive aspect stage", () => {
    mockState = {
      streams: [
        { id: "s1", platform: "twitch", channelName: "ninja" },
        { id: "s2", platform: "kick", channelName: "xqc" },
      ],
      layout: "focus",
      focusedStreamId: "s1",
      playbackBudget: 4,
    };

    renderWithProviders(<MultiStreamGrid />);

    expect(screen.getByTestId("aspect-aware-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("slot")).toHaveLength(2);
  });

  it("partial-loading: all N slots mount independently while the playback budget admits decoders", () => {
    mockState = {
      streams: [
        { id: "s1", platform: "twitch", channelName: "a" },
        { id: "s2", platform: "kick", channelName: "b" },
        { id: "s3", platform: "twitch", channelName: "c" },
      ],
      layout: "grid",
      focusedStreamId: null,
      playbackBudget: 2,
    };
    renderWithProviders(<MultiStreamGrid />);
    expect(screen.getAllByTestId("sortable-slot")).toHaveLength(3);
    expect(
      screen.getAllByTestId("sortable-slot").map((slot) => slot.dataset.playbackActive)
    ).toEqual(["true", "true", "false"]);
  });

  it("probes WCV capability once for every mounted slot", async () => {
    mockState = {
      streams: [
        { id: "s1", platform: "twitch", channelName: "a" },
        { id: "s2", platform: "kick", channelName: "b" },
        { id: "s3", platform: "twitch", channelName: "c" },
      ],
      layout: "grid",
      focusedStreamId: null,
      playbackBudget: 3,
    };
    const api = installElectronAPIMock();
    api.slot.isWcvEnabled = vi.fn(async () => true);

    renderWithProviders(<MultiStreamGrid />);

    await waitFor(() => expect(api.slot.isWcvEnabled).toHaveBeenCalledTimes(1));
    expect(screen.getAllByTestId("sortable-slot").map((slot) => slot.dataset.wcvEnabled)).toEqual([
      "true",
      "true",
      "true",
    ]);
  });
});
